// ===== CONFIGURACION =====
const FEED_NAME = "MODIFICAR";
const FEED_DESCRIPTION = "MODIFICAR";
const FEED_AUTHOR = "MODIFICAR";
const REPO_OWNER = "MODIFICAR";
const REPO_NAME = "MODIFICAR";                 
const BRANCH = "MODIFICAR";
const FEED_FILE_PATH = "feed-podcasts.xml";
const AUDIO_FOLDER_PATH = "MODIFICAR";
const DRIVE_FOLDER_ID = "MODIFICAR";

// true -> URLs https://usuario.github.io/repo/...
// false -> URLs https://raw.githubusercontent.com/usuario/repo/branch/...
const USE_GITHUB_PAGES = true;

// Imagen del podcast (aparecerá en todos los episodios)
const PODCAST_IMAGE_URL = "https://splasradio.com/wp-content/uploads/2026/06/iVoox_Isotipo_negativo.png";

// Límite de tamaño permitido por la API de GitHub (100 MB)
const LIMITE_BYTES = 100 * 1024 * 1024;

// Nº de archivos nuevos a procesar por ejecución (1 = seguro contra "Out of memory")
const MAX_ARCHIVOS_POR_EJECUCION = 1;

// ===== UTILIDADES =====
function construirUrlPublica(pathRelativo) {
  if (USE_GITHUB_PAGES) {
    return `https://${REPO_OWNER}.github.io/${REPO_NAME}/${pathRelativo}`;
  }
  return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${pathRelativo}`;
}

function apiContentsUrl(pathRelativo) {
  return `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${pathRelativo}`;
}

function getGithubToken() {
  return PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ===== REGISTRO PERSISTENTE =====
// Estructura: { fileId: { name, title, pubDate, modified, tooBig?, size? } }
function cargarRegistro() {
  const raw = PropertiesService.getScriptProperties().getProperty('REGISTRO_AUDIOS');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function guardarRegistro(registro) {
  PropertiesService.getScriptProperties().setProperty(
    'REGISTRO_AUDIOS',
    JSON.stringify(registro)
  );
}

// ===== COMPRUEBA SI UN ARCHIVO YA EXISTE EN GITHUB =====
function existeEnGitHub(pathRelativo) {
  const token = getGithubToken();
  const res = UrlFetchApp.fetch(apiContentsUrl(pathRelativo), {
    headers: { 'Authorization': `Bearer ${token}` },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 200) {
    return JSON.parse(res.getContentText('UTF-8'));
  }
  return null;
}

// ===== SUBE UN ARCHIVO A GITHUB (con liberación de memoria) =====
function subirArchivoAGitHub(file, shaExistente) {
  const token = getGithubToken();
  const fileName = file.getName();
  const pathRelativo = `${AUDIO_FOLDER_PATH}/${fileName}`;

  // 1) Bytes originales
  let bytes = file.getBlob().getBytes();

  // 2) Codificación Base64
  let contentBase64 = Utilities.base64Encode(bytes);

  // 3) Liberamos bytes: ya no los necesitamos
  bytes = null;

  // 4) Payload y su serialización
  const payload = {
    message: `Audio: ${fileName}`,
    content: contentBase64,
    branch: BRANCH
  };
  if (shaExistente) payload.sha = shaExistente;

  const payloadStr = JSON.stringify(payload);

  // 5) Liberamos la cadena Base64 original: el payload serializado ya la contiene
  contentBase64 = null;

  const res = UrlFetchApp.fetch(apiContentsUrl(pathRelativo), {
    method: "PUT",
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    },
    payload: payloadStr,
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code !== 200 && code !== 201) {
    Logger.log(`Error subiendo ${fileName}: ${code} - ${res.getContentText('UTF-8')}`);
    return false;
  }
  return true;
}

// ===== SUBE COMO MÁXIMO 1 ARCHIVO NUEVO POR EJECUCIÓN =====
function subirAudiosNuevosAGitHub() {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const files = folder.getFiles();
  const registro = cargarRegistro();

  let procesados = 0;       // archivos nuevos efectivamente tratados (subidos o marcados)
  let saltados = 0;
  let subidos = 0;
  let borrados = 0;
  let demasiadoGrande = 0;

  while (files.hasNext() && procesados < MAX_ARCHIVOS_POR_EJECUCION) {
    let file = files.next();
    const name = file.getName();

    if (!name.match(/\.(mp3|m4a|wav)$/i)) {
      file = null;
      continue;
    }

    const id = file.getId();
    const modified = file.getLastUpdated().getTime();
    const entrada = registro[id];

    // Ya procesado y sin cambios -> saltar
    if (entrada && entrada.name === name && entrada.modified === modified) {
      saltados++;
      file = null;
      continue;
    }

    // --- Comprobación de tamaño ---
    const size = file.getSize();
    if (size > LIMITE_BYTES) {
      const sizeMB = (size / 1024 / 1024).toFixed(2);
      Logger.log(`Archivo ${name} (${sizeMB} MB) supera 100 MB. Se añade al feed sin audio.`);

      registro[id] = {
        name: name,
        title: name.replace(/\.[^/.]+$/, ""),
        pubDate: file.getDateCreated().toUTCString(),
        modified: modified,
        tooBig: true,
        size: size
      };
      demasiadoGrande++;
      procesados++;

      // NO se borra de Drive aunque se active el borrado general.
      file = null;
      continue;
    }

    // --- Subida normal a GitHub ---
    let shaExistente = null;
    const info = existeEnGitHub(`${AUDIO_FOLDER_PATH}/${name}`);
    if (info) shaExistente = info.sha;

    const ok = subirArchivoAGitHub(file, shaExistente);
    if (!ok) {
      // Si falla la subida, no registramos nada (se reintentará en la próxima ejecución)
      file = null;
      continue;
    }

    registro[id] = {
      name: name,
      title: name.replace(/\.[^/.]+$/, ""),
      pubDate: file.getDateCreated().toUTCString(),
      modified: modified
    };
    subidos++;
    procesados++;

    // ============================================================
    // ===== BORRAR EL MP3 DE GOOGLE DRIVE TRAS SUBIRLO A GITHUB ===
    // ============================================================
    // DESCOMENTA LAS DOS LÍNEAS SIGUIENTES CUANDO QUIERAS ACTIVARLO.
    //
    // file.setTrashed(true);
    // borrados++;
    // ============================================================

    file = null; // liberar
  }

  guardarRegistro(registro);
  Logger.log(
    `Subidos: ${subidos} | Demasiado grandes: ${demasiadoGrande} | ` +
    `Saltados: ${saltados} | Borrados: ${borrados}`
  );
}

// ===== GENERA EL XML DEL FEED (desde el REGISTRO) =====
function generarXMLFeed() {
  const registro = cargarRegistro();

  const entradas = Object.keys(registro).map(id => {
    return Object.assign({ id: id }, registro[id]);
  });
  entradas.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  let items = "";
  for (const e of entradas) {
    let item = `
    <item>
      <title>${escapeXml(e.title)}</title>
      <pubDate>${e.pubDate}</pubDate>
      <guid isPermaLink="false">${e.id}</guid>
      <itunes:author>${FEED_AUTHOR}</itunes:author>
      <itunes:image href="${PODCAST_IMAGE_URL}" />`;

    if (e.tooBig) {
      // Item sin audio: no ponemos <enclosure>
      item += `
      <description>Archivo superior a 100MB</description>`;
    } else {
      const pathRelativo = `${AUDIO_FOLDER_PATH}/${encodeURIComponent(e.name)}`;
      const url = construirUrlPublica(pathRelativo);
      item += `
      <enclosure url="${url}" length="0" type="audio/mpeg" />`;
    }

    item += `
    </item>`;

    items += item;
  }

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${FEED_NAME}</title>
    <description>${FEED_DESCRIPTION}</description>
    <link>https://${REPO_OWNER}.github.io/${REPO_NAME}/</link>
    <language>es</language>
    <itunes:author>${FEED_AUTHOR}</itunes:author>
    <itunes:category text="Music"/>
    <itunes:explicit>no</itunes:explicit>

    <image>
      <url>${PODCAST_IMAGE_URL}</url>
      <title>${FEED_NAME}</title>
      <link>https://${REPO_OWNER}.github.io/${REPO_NAME}/</link>
    </image>
    <itunes:image href="${PODCAST_IMAGE_URL}" />

    ${items}
  </channel>
</rss>`;

  return rss;
}

// ===== SUBE EL FEED A GITHUB (solo si cambió) =====
function subirFeedAGitHub() {
  const contenidoXML = generarXMLFeed();
  const token = getGithubToken();

  const info = existeEnGitHub(FEED_FILE_PATH);
  let sha = null;

  if (info) {
    const actual = UrlFetchApp.fetch(
      `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${FEED_FILE_PATH}?t=${Date.now()}`,
      { muteHttpExceptions: true }
    );
    if (actual.getResponseCode() === 200 &&
        actual.getContentText('UTF-8') === contenidoXML) {
      Logger.log("feed-podcasts.xml sin cambios. No se sube.");
      return 200;
    }
    sha = info.sha;
  }

  // Fuerza UTF-8 al pasar el XML a bytes antes de Base64
  const blob = Utilities.newBlob(contenidoXML, 'text/xml', 'feed-podcasts.xml');
  let contenidoBase64 = Utilities.base64Encode(blob.getBytes());

  const payload = {
    message: "Actualización automática del feed RSS",
    content: contenidoBase64,
    branch: BRANCH
  };
  if (sha) payload.sha = sha;

  const payloadStr = JSON.stringify(payload);
  contenidoBase64 = null; // liberar

  const res = UrlFetchApp.fetch(apiContentsUrl(FEED_FILE_PATH), {
    method: "PUT",
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    },
    payload: payloadStr,
    muteHttpExceptions: true
  });

  Logger.log("Feed GitHub Response Code: " + res.getResponseCode());
  return res.getResponseCode();
}

// ===== FUNCIÓN PRINCIPAL (trigger) =====
function actualizarTodo() {
  subirAudiosNuevosAGitHub(); // Procesa como máximo 1 archivo nuevo
  subirFeedAGitHub();
}
