// ===== CONFIGURACIÓN =====
const FEED_NAME = "Originals Podcast";
const FEED_DESCRIPTION = "Podcast Original de EREBOR";
const FEED_AUTHOR = "EREBOR";
const REPO_OWNER = "tu_usuario_github";      // <-- CAMBIA ESTO
const REPO_NAME = "tu_repo";                 // <-- CAMBIA ESTO
const BRANCH = "main";
const FEED_FILE_PATH = "feed.xml";
const AUDIO_FOLDER_PATH = "audio";           // carpeta dentro del repo para los mp3
const DRIVE_FOLDER_ID = "ID_DE_LA_CARPETA_DE_DRIVE"; // <-- CAMBIA ESTO

// ===== GENERA EL XML DEL FEED =====
function generarXMLFeed() {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const files = folder.getFiles();
  let items = "";

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();

    if (!name.match(/\.(mp3|m4a|wav)$/i)) continue;

    const title = name.replace(/\.[^/.]+$/, "");
    const pubDate = file.getDateCreated().toUTCString();
    // URL raw de GitHub (el archivo ya debe estar subido)
    const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${AUDIO_FOLDER_PATH}/${encodeURIComponent(name)}`;

    items += `
    <item>
      <title>${title}</title>
      <pubDate>${pubDate}</pubDate>
      <enclosure url="${rawUrl}" length="0" type="audio/mpeg" />
      <guid>${file.getId()}</guid>
      <itunes:author>${FEED_AUTHOR}</itunes:author>
    </item>`;
  }

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${FEED_NAME}</title>
    <description>${FEED_DESCRIPTION}</description>
    <link>https://github.com/${REPO_OWNER}/${REPO_NAME}</link>
    <language>es</language>
    <itunes:author>${FEED_AUTHOR}</itunes:author>
    <itunes:category text="Music"/>
    <itunes:explicit>no</itunes:explicit>
    ${items}
  </channel>
</rss>`;

  return rss;
}

// ===== SUBE UN ARCHIVO A GITHUB =====
function subirArchivoAGitHub(file) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const fileName = file.getName();
  const filePath = `${AUDIO_FOLDER_PATH}/${fileName}`;
  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;

  // 1. Obtener el contenido del archivo como bytes y codificarlo en Base64
  const bytes = file.getBlob().getBytes();
  const contentBase64 = Utilities.base64Encode(bytes);

  // 2. Comprobar si ya existe para obtener el SHA
  let sha = null;
  try {
    const getResponse = UrlFetchApp.fetch(apiUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true
    });
    if (getResponse.getResponseCode() === 200) {
      sha = JSON.parse(getResponse.getContentText()).sha;
    }
  } catch (e) {}

  // 3. Si ya existe y el contenido es el mismo, no hace falta volver a subir (opcional)
  //    Para simplificar, siempre subimos/actualizamos.

  const payload = {
    message: `Añadido/Actualizado audio: ${fileName}`,
    content: contentBase64,
    branch: BRANCH
  };
  if (sha) payload.sha = sha;

  const options = {
    method: "PUT",
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  const code = response.getResponseCode();
  if (code !== 200 && code !== 201) {
    Logger.log(`Error subiendo ${fileName}: ${code} - ${response.getContentText()}`);
    return false;
  }
  return true;
}

// ===== SUBE TODOS LOS MP3 NUEVOS A GITHUB =====
function subirAudiosAGitHub() {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const files = folder.getFiles();
  let subidos = 0;

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (!name.match(/\.(mp3|m4a|wav)$/i)) continue;

    // Para evitar subir siempre lo mismo, podrías llevar un registro,
    // pero aquí subimos/actualizamos todos los que encuentre.
    if (subirArchivoAGitHub(file)) {
      subidos++;
    }
  }
  Logger.log(`Audios procesados: ${subidos}`);
}

// ===== SUBE EL FEED A GITHUB =====
function subirFeedAGitHub() {
  const contenidoXML = generarXMLFeed();
  const contenidoBase64 = Utilities.base64Encode(contenidoXML);

  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FEED_FILE_PATH}`;
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');

  let sha = null;
  try {
    const getResponse = UrlFetchApp.fetch(apiUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true
    });
    if (getResponse.getResponseCode() === 200) {
      sha = JSON.parse(getResponse.getContentText()).sha;
    }
  } catch (e) {}

  const payload = {
    message: "Actualización automática del feed RSS",
    content: contenidoBase64,
    branch: BRANCH
  };
  if (sha) payload.sha = sha;

  const options = {
    method: "PUT",
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  Logger.log("Feed GitHub Response Code: " + response.getResponseCode());
  return response.getResponseCode();
}

// ===== FUNCIÓN PRINCIPAL (para ejecutar con trigger) =====
function actualizarTodo() {
  subirAudiosAGitHub();   // 1. Sube los mp3 nuevos a GitHub
  subirFeedAGitHub();     // 2. Actualiza el feed.xml con las URLs raw
}
