// Settings that come from the environment rather than app.json (step 50, phase 4).
// Sign in with Google needs the iOS client's "reversed client ID" as a URL scheme
// (Google Cloud > Credentials > the iOS OAuth client, e.g.
// com.googleusercontent.apps.1234-abcd). Until it's set, the Google sign-in plugin is
// left out so builds still work, and the app hides the Google button.
//   EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME  com.googleusercontent.apps....
module.exports = ({ config }) => {
  const scheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  const plugins = [...(config.plugins ?? [])];
  if (scheme) plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: scheme }]);
  return { ...config, plugins };
};
