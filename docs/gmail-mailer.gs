/**
 * The Points League Gmail mailer.
 *
 * Deploy as a Google Apps Script web app that executes as your Gmail account.
 * Set POINTS_LEAGUE_TOKEN in Project Settings > Script properties before deploy.
 */
function doPost(e) {
  try {
    const message = JSON.parse(e.postData.contents || '{}');
    const token = message.token;
    if (!token || token !== PropertiesService.getScriptProperties().getProperty('POINTS_LEAGUE_TOKEN')) {
      return json({ ok: false, error: 'Unauthorized' });
    }

    if (!message.to || !message.subject || !message.text) {
      return json({ ok: false, error: 'Missing email fields' });
    }

    GmailApp.sendEmail(message.to, message.subject, message.text, { name: 'The Points League' });
    return json({ ok: true });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: 'Unable to send email' });
  }
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
