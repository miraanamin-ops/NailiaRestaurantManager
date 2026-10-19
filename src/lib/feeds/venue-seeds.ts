// The five big venues near our East London restaurants. capacity is the venue's
// own figure; typical_crowd is an estimate of a usual event there (an event's
// expected size), which the builder can change on /feeds/venues. London
// Stadium and ExCeL as in the synthetic data (analytics/generator/synth/outside/data/venues.json).
export const SEED_VENUES = [
  { name: "London Stadium", kind: "stadium", latitude: 51.53833, longitude: -0.01658, capacity: 62500, typical_crowd: 60000, teams: ["West Ham"] },
  { name: "ExCeL London", kind: "other", latitude: 51.5085, longitude: 0.0295, capacity: 100000, typical_crowd: 25000, teams: [] },
  { name: "The O2", kind: "arena", latitude: 51.50304, longitude: 0.0032, capacity: 20000, typical_crowd: 17000, teams: [] },
  { name: "Wembley Stadium", kind: "stadium", latitude: 51.55595, longitude: -0.27964, capacity: 90000, typical_crowd: 80000, teams: ["England"] },
  { name: "Tottenham Hotspur Stadium", kind: "stadium", latitude: 51.60433, longitude: -0.06663, capacity: 62850, typical_crowd: 60000, teams: ["Tottenham"] },
] as const;
