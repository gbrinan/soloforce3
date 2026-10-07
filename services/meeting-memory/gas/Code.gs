/** Script Properties: SERVICE_URL, SERVICE_TOKEN, DRIVE_FOLDER_ID, PROJECT_ID */
function installTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'scanRecordings').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('scanRecordings').timeBased().everyMinutes(5).create();
}
function scanRecordings() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const cfg = props.getProperties();
    ['SERVICE_URL', 'SERVICE_TOKEN', 'DRIVE_FOLDER_ID', 'PROJECT_ID'].forEach(key => { if (!cfg[key]) throw new Error('Missing property: ' + key); });
    if (!cfg.SERVICE_URL.startsWith('https://')) throw new Error('HTTPS required');
    const started = Date.now();
    let token = cfg.PAGE_TOKEN || undefined;
    const since = cfg.SCAN_SINCE || '1970-01-01T00:00:00.000Z';
    const until = cfg.SCAN_UNTIL || new Date(Date.now() - 120000).toISOString();
    props.setProperty('SCAN_UNTIL', until);
    do {
      const result = Drive.Files.list({
        q: "'" + cfg.DRIVE_FOLDER_ID.replace(/'/g, "\'") + "' in parents and trashed=false and modifiedTime >= '" + since + "' and modifiedTime <= '" + until + "'",
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,version)',
        pageSize: 30, pageToken: token, orderBy: 'modifiedTime', supportsAllDrives: true, includeItemsFromAllDrives: true
      });
      (result.files || []).filter(f => f.mimeType.startsWith('audio/') || f.mimeType === 'video/mp4').forEach(f => {
        const response = UrlFetchApp.fetch(cfg.SERVICE_URL.replace(/\/$/, '') + '/v1/meetings', {
          method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + cfg.SERVICE_TOKEN },
          payload: JSON.stringify({ project: cfg.PROJECT_ID, title: f.name, date: f.modifiedTime.slice(0,10), sourceId: f.id, revision: f.version || f.modifiedTime, driveFileId: f.id, transcriptionProvider: cfg.TRANSCRIPTION_PROVIDER || "groq" }),
          muteHttpExceptions: true
        });
        if (response.getResponseCode() !== 202) throw new Error('Queue registration failed: HTTP ' + response.getResponseCode());
      });
      token = result.nextPageToken;
      if (token) props.setProperty('PAGE_TOKEN', token);
      if (Date.now() - started > 240000 && token) return;
    } while (token);
    props.setProperty('SCAN_SINCE', until);
    props.deleteProperty('SCAN_UNTIL'); props.deleteProperty('PAGE_TOKEN');
  } finally { lock.releaseLock(); }
}
