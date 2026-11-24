(() => {
  'use strict';
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  // The feed reports cumulative lots; a column is the change since the prior sample.
  function samples(points) {
    return points.map((point, index) => {
      const current = valid(point.volume) ? point.volume : null;
      const previous = index ? points[index - 1].volume : 0;
      if (Object.prototype.hasOwnProperty.call(point, 'intervalVolume')) {
        const volume = valid(point.intervalVolume) ? point.intervalVolume : null;
        return {volume, cumulative: current, first: index === 0, interval: point.time,
          note: volume === null ? '数据源未提供本段量' : current === null ? '累计量不完整，暂不显示累计值' : !index ? '首段含开盘累计量' : ''};
      }
      let volume = null, note = '';
      if (current === null) note = '数据源未提供累计量';
      else if (!valid(previous)) note = '前一时点累计量缺失，无法计算本段量';
      else if (current < previous) note = '累计量回退，本段量暂不可用';
      else volume = current - previous;
      if (!index && current !== null) note = '首段含开盘累计量';
      return {volume, cumulative: current, first: index === 0,
        interval: index ? `${points[index - 1].time} → ${point.time}` : point.time, note};
    });
  }
  const format = value => valid(value)
    ? value.toLocaleString('zh-CN', {maximumFractionDigits: 2}) + ' 手' : '—';
  window.ChartVolume = {samples, format};
})();
