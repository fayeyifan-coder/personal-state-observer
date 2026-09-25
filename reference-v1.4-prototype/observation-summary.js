(() => {
  'use strict';

  function values(records, field) {
    return records.map(r => r?.[field]).filter(v => typeof v === 'number' && Number.isFinite(v));
  }

  function average(records, field) {
    const list = values(records, field);
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
  }

  function countWhere(records, predicate) {
    return records.filter(predicate).length;
  }

  function countMarkedDays(records, predicate) {
    return countWhere(records, predicate);
  }

  function summarizeMonth(records, days, labels) {
    const inMonth = records.filter(r => days.includes(r.recordDate));
    const recorded = inMonth.filter(r => r.recordingStatus === 'recorded');
    const optedOut = inMonth.filter(r => r.recordingStatus === 'opted_out');
    const drafts = inMonth.filter(r => r.recordingStatus === 'draft');
    const moodValues = values(inMonth, 'mood');
    const energyValues = values(inMonth, 'energy');
    const driveValues = values(inMonth, 'drive');
    const sleepValues = values(inMonth, 'sleepDurationMin');
    const sleepHours = sleepValues.length ? sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length / 60 : null;
    const eventDays = countMarkedDays(inMonth, r =>
      (r.bleedingLevel && r.bleedingLevel !== 'none') ||
      r.dischargeAmount != null ||
      (typeof r.physicalDiscomfort === 'number' && r.physicalDiscomfort >= 3)
    );
    const visibleLabels = labels.filter(label => days.some(d => d >= label.startDate && d <= label.endDate));

    return {
      activeDays: inMonth.length,
      recordedDays: recorded.length,
      optedOutDays: optedOut.length,
      draftDays: drafts.length,
      moodDays: moodValues.length,
      energyDays: energyValues.length,
      driveDays: driveValues.length,
      sleepDays: sleepValues.length,
      averageSleepHours: sleepHours,
      averageMood: average(inMonth, 'mood'),
      averageEnergy: average(inMonth, 'energy'),
      averageDrive: average(inMonth, 'drive'),
      eventDays,
      periodLabelCount: visibleLabels.length
    };
  }

  function formatHours(hours) {
    if (hours == null) return '—';
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m ? `${h}h ${m}min` : `${h}h`;
  }

  function formatAverage(value) {
    return value == null ? '—' : value.toFixed(1);
  }

  window.StateObserverSummary = { summarizeMonth, formatHours, formatAverage };
})();
