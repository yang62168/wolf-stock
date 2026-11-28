export const volumeAlertDefaults = Object.freeze({
  window: 5,
  upper: 1.5,
  lower: 0.65,
  slope: 3,
  cooldown: 5,
  mode: 'and',
});

export function normalizeVolumeAlerts(settings = {}) {
  const bounded = (key, min, max) => {
    const value = settings?.[key];
    const number = value === '' || value == null ? NaN : Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : volumeAlertDefaults[key];
  };
  return {
    window: [3, 5, 10].includes(Number(settings?.window)) ? Number(settings.window) : 5,
    upper: bounded('upper', 1.01, 100),
    lower: bounded('lower', 0, 0.99),
    slope: bounded('slope', 0.01, 1000),
    cooldown: Math.round(bounded('cooldown', 0, 60)),
    mode: settings?.mode === 'or' ? 'or' : 'and',
  };
}

function slopeAt(ratios, minute, window) {
  const center = (window - 1) / 2;
  let covariance = 0;
  let squares = 0;
  for (let offset = 0; offset < window; offset++) {
    const ratio = ratios.get(minute - window + 1 + offset);
    if (!Number.isFinite(ratio)) return null;
    const x = offset - center;
    covariance += x * (ratio - 1) * 100;
    squares += x * x;
  }
  return covariance / squares;
}

export function analyzeVolumeAlerts(current, prior, settings, enabled = true) {
  const {window, upper, lower, slope, cooldown, mode} = normalizeVolumeAlerts(settings);
  const ratios = new Map();
  const events = [];
  const lastEvent = new Map();
  let previousMinute = -Infinity;
  let active = null;

  for (const minute of current.keys()) {
    if (minute !== previousMinute + 1) active = null;
    previousMinute = minute;
    let now = 0;
    let base = 0;
    for (let point = minute - window + 1; point <= minute; point++) {
      now += current.get(point);
      base += prior.get(point);
    }
    if (!Number.isFinite(now) || !Number.isFinite(base) || base <= 0) {
      active = null;
      continue;
    }
    const ratio = now / base;
    ratios.set(minute, ratio);
    const trend = slopeAt(ratios, minute, window);
    if (!enabled || minute < 575) continue;

    const matches = (threshold, trendThreshold) => mode === 'and'
      ? threshold && trendThreshold
      : threshold || trendThreshold;
    const up = matches(ratio >= upper, trend !== null && trend >= slope);
    const down = matches(ratio <= lower, trend !== null && trend <= -slope);
    const direction = up === down ? null : up ? 'up' : 'down';
    if (direction && direction !== active && minute - (lastEvent.get(direction) ?? -Infinity) >= cooldown) {
      events.push({minute, direction, ratio, slope: trend, window});
      lastEvent.set(direction, minute);
    }
    active = direction;
  }
  return {ratios, events};
}
