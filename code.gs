  // ===== CONFIGURACIÓN =====
const FEED_NAME = "Smile Running Man";
const FEED_DESCRIPTION = "Feed personal de canciones para correr";
const REPO_OWNER = "zokosting"; 
const REPO_NAME = "rss";      
const FILE_PATH = "feed.xml";     
const BRANCH = "main";                     

// ===== GENERA EL XML DEL FEED =====
function generarXMLFeed() {
  const folder = DriveApp.getRootFolder();
  const files = folder.getFiles();
  let items = "";
  
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    
    // Solo procesa archivos de audio
    if (!name.match(/\.(mp3|m4a|wav)$/i)) continue;
    // Ignora el propio feed.xml si existiera
    if (name === "feed.xml") continue;
    
    const title = name.replace(/\.[^/.]+$/, "");
    const pubDate = file.getDateCreated().toUTCString();
    const downloadUrl = getDownloadUrl(file.getId());
    
    items += `
    <item>
      <title>${title}</title>
      <pubDate>${pubDate}</pubDate>
      <enclosure url="${downloadUrl}" length="0" type="audio/mpeg" />
      <guid>${file.getId()}</guid>
    </item>`;
  }
  
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${FEED_NAME}</title>
    <description>${FEED_DESCRIPTION}</description>
    <link>https://github.com/${REPO_OWNER}/${REPO_NAME}</link>
    ${items}
  </channel>
</rss>`;
  
  return rss;
}

// ===== OBTIENE EL ENLACE DIRECTO DEL AUDIO =====
function getDownloadUrl(fileId) {
  const API_KEY = PropertiesService.getScriptProperties().getProperty('GOOGLE_API_KEY');
  return "https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media&key=" + API_KEY;
}

// ===== SUBE EL FEED A GITHUB =====
function subirFeedAGitHub() {
  const contenidoXML = generarXMLFeed();
  const contenidoBase64 = Utilities.base64Encode(contenidoXML);
  
  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  
  // Comprueba si el archivo ya existe para obtener su SHA
  let sha = null;
  try {
    const getResponse = UrlFetchApp.fetch(apiUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true
    });
    if (getResponse.getResponseCode() === 200) {
      const fileInfo = JSON.parse(getResponse.getContentText());
      sha = fileInfo.sha;
    }
  } catch (e) {
    // Si da 404, el archivo no existe, lo crearemos desde cero
  }
  
  const payload = {
    message: "Actualización automática del feed RSS",
    content: contenidoBase64,
    branch: BRANCH
  };
  if (sha) {
    payload.sha = sha;
  }
  
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
  Logger.log("GitHub Response Code: " + response.getResponseCode());
  Logger.log("GitHub Response: " + response.getContentText());
  return response.getResponseCode();
}
