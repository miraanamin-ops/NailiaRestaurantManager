"""The negative binomial fit: penalised maximum likelihood (MAP) with a Normal prior per weight.

  orders ~ NB(mean mu, dispersion theta), log mu = X beta + offset
  maximise  sum_d w_d loglik(y_d) - sum_k (beta_k - m_k)^2 / (2 s_k^2) - (log theta - m_t)^2 / (2 s_t^2)

w_d are the time-decay (and censoring) weights. Fitted by Fisher scoring (with
L-BFGS-B and the exact gradient as the fallback). Uncertainty: the Laplace approximation, i.e. beta ~ Normal(beta_hat, H^-1)
with H the expected information plus the prior precision (theta held at its estimate).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize
from scipy.special import digamma, gammaln, polygamma

MAX_ETA = 20.0


@dataclass
class Fit:
    beta: np.ndarray
    log_theta: float
    cov: np.ndarray  # covariance of beta (Laplace)
    converged: bool
    iterations: int
    loglik: float

    @property
    def theta(self) -> float:
        return float(np.exp(self.log_theta))

    @property
    def sd(self) -> np.ndarray:
        return np.sqrt(np.clip(np.diag(self.cov), 0, None))


def _objective(params, X, y, offset, w, m, prec, mt, prect, lgy1):
    beta, lt = params[:-1], params[-1]
    theta = np.exp(lt)
    eta = np.clip(X @ beta + offset, -MAX_ETA, MAX_ETA)
    mu = np.exp(eta)
    tm = theta + mu
    log_tm = np.log(tm)
    ll = gammaln(y + theta) - gammaln(theta) - lgy1 + theta * lt + y * eta - (y + theta) * log_tm
    db = beta - m
    f = -(w @ ll) + 0.5 * (prec @ (db * db)) + 0.5 * prect * (lt - mt) ** 2
    g_eta = w * theta * (y - mu) / tm
    g_beta = -(X.T @ g_eta) + prec * db
    g_lt = -(w @ (theta * (digamma(y + theta) - digamma(theta) + lt + 1 - log_tm - (y + theta) / tm))) + prect * (lt - mt)
    return f, np.concatenate([g_beta, [g_lt]])


def _scoring(X, y, offset, w, m, prec, mt, prect, lgy1, init, max_iter: int = 60, tol: float = 1e-7):
    """Fisher scoring for beta (a Newton step of the penalised GLM, with step halving if the objective
    gets worse), alternated with a safeguarded Newton step for log theta. Usually under 10 iterations;
    returns None if it didn't converge (the caller then uses L-BFGS)."""
    beta, lt = init[:-1].copy(), float(init[-1])
    args = (X, y, offset, w, m, prec, mt, prect, lgy1)
    f_old = _objective(np.concatenate([beta, [lt]]), *args)[0]
    P = np.diag(prec)
    for it in range(1, max_iter + 1):
        theta = np.exp(lt)
        eta = np.clip(X @ beta + offset, -MAX_ETA, MAX_ETA)
        mu = np.exp(eta)
        W = w * mu * theta / (theta + mu)
        z = eta - offset + (y - mu) / mu
        H = (X.T * W) @ X + P
        try:
            target = np.linalg.solve(H + np.eye(len(beta)) * 1e-10, X.T @ (W * z) + prec * m)
        except np.linalg.LinAlgError:
            return None
        step = target - beta
        # log theta: one Newton step on its own (beta fixed), damped.
        tm = theta + mu
        g1 = digamma(y + theta) - digamma(theta) + lt + 1 - np.log(tm) - (y + theta) / tm
        g2 = polygamma(1, y + theta) - polygamma(1, theta) + 1 / theta - 2 / tm + (y + theta) / tm**2
        grad = w @ (theta * g1) - prect * (lt - mt)
        hess = w @ (theta * g1 + theta**2 * g2) - prect
        d_lt = float(np.clip(-grad / hess if hess < 0 else np.sign(grad) * 0.5, -1.0, 1.0))
        scale = 1.0
        while True:
            new = np.concatenate([beta + scale * step, [lt + scale * d_lt]])
            f_new = _objective(new, *args)[0]
            if f_new <= f_old + 1e-10 or scale < 1e-4:
                break
            scale /= 2
        beta, lt = new[:-1], float(new[-1])
        done = abs(f_old - f_new) < tol * (1 + abs(f_old)) and np.max(np.abs(scale * step)) < 1e-5
        f_old = f_new
        if done:
            return beta, lt, it, f_new
    return None


def fit_nb(X: np.ndarray, y: np.ndarray, offset: np.ndarray, w: np.ndarray, prior_mean: np.ndarray, prior_sd: np.ndarray,
           theta_prior: tuple[float, float] = (np.log(20.0), 1.5), init: np.ndarray | None = None) -> Fit:
    """prior_sd may be inf (a flat prior, e.g. the level)."""
    prec = np.where(np.isfinite(prior_sd), 1.0 / np.square(prior_sd), 0.0)
    m = np.where(np.isfinite(prior_mean), prior_mean, 0.0)
    mt, st = theta_prior
    if init is None:
        init = np.concatenate([m, [mt]])
        # Start the level (first column, all ones) near the data.
        rate = np.sum(w * y) / max(np.sum(w * np.exp(offset)), 1e-9)
        init[0] = np.log(max(rate, 1e-3)) - (X[:, 1:] @ m[1:]).mean() if X.shape[1] > 1 else np.log(max(rate, 1e-3))
    lgy1 = gammaln(y + 1)
    prect = 1.0 / st**2
    scored = _scoring(X, y, offset, w, m, prec, mt, prect, lgy1, np.asarray(init, dtype=float))
    if scored is not None:
        beta, lt, nit, fun = scored
        success = True
    else:
        res = minimize(_objective, init, args=(X, y, offset, w, m, prec, mt, prect, lgy1), jac=True, method="L-BFGS-B",
                       options={"maxiter": 1000, "gtol": 1e-6})
        beta, lt, nit, fun, success = res.x[:-1], float(res.x[-1]), int(res.nit), float(res.fun), bool(res.success)
    theta = np.exp(lt)
    mu = np.exp(np.clip(X @ beta + offset, -MAX_ETA, MAX_ETA))
    info = w * mu * theta / (theta + mu)
    H = (X.T * info) @ X + np.diag(prec + 1e-8)
    try:
        cov = np.linalg.inv(H)
    except np.linalg.LinAlgError:
        cov = np.linalg.pinv(H)
    cov = (cov + cov.T) / 2
    return Fit(beta, lt, cov, success, nit, -fun)


def draw_beta(fit: Fit, n: int, rng: np.random.Generator) -> np.ndarray:
    """n draws of beta from the Laplace approximation, (n, p)."""
    try:
        L = np.linalg.cholesky(fit.cov + np.eye(len(fit.beta)) * 1e-12)
    except np.linalg.LinAlgError:
        vals, vecs = np.linalg.eigh(fit.cov)
        L = vecs * np.sqrt(np.clip(vals, 0, None))
    return fit.beta + rng.standard_normal((n, len(fit.beta))) @ L.T


def draw_counts(mu: np.ndarray, theta: float, rng: np.random.Generator) -> np.ndarray:
    """NB draws with mean mu (any shape): Poisson with a gamma-distributed rate."""
    lam = rng.gamma(theta, np.maximum(mu, 1e-12) / theta)
    return rng.poisson(lam).astype(float)
