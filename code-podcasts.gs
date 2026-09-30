// ===== CONFIGURACION =====
const FEED_NAME = "Originals Podcast";
const FEED_DESCRIPTION = "Podcasts Originals";
const FEED_AUTHOR = "EREBOR";
const REPO_OWNER = "zokosting";
const REPO_NAME = "rss";
const BRANCH = "main";
const FEED_FILE_PATH = "feed-podcasts.xml";
const AUDIO_FOLDER_PATH = "Podcasts";
const DRIVE_FOLDER_ID = "1R62N1yTogfhx1j0A1B7lOw_bz13z7XiE";

const USE_GITHUB_PAGES = true;

const PODCAST_IMAGE_URL = "https://splasradio.com/wp-content/uploads/2026/06/iVoox_Isotipo_negativo.png";

const LIMITE_BYTES = 30 * 1024 * 1024;
const MAX_ARCHIVOS_POR_EJECUCION = 1;

// Antigüedad máxima de los archivos alojados en GitHub (1 año)
const ANTIGUEDAD_MAXIMA_MS = 365 * 24 * 60 * 60 * 1000;

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

function sanitizeFileName(titulo) {
  return titulo
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
}

// ===== OBTENER INFORMACIÓN DESDE IVOOX =====
function obtenerInfoIvoox(slug) {
  try {
    const url = `https://www.ivoox.com/${slug}.html`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;

    const html = res.getContentText('UTF-8');

    let titleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (!titleMatch) {
      titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    }
    let title = titleMatch ? titleMatch[1] : slug;
    if (title.includes(' - ')) {
      title = title.split(' - ')[0].trim();
    }

    const descMatch = html.match(/<meta[^>]*name=["']twitter:description["'][^>]*content=["']([\s\S]*?)["']\s*\/?>/i);
    let description = descMatch
      ? descMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
      : '';

    const imgMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    const image = imgMatch ? imgMatch[1] : '';

    return { title: title, description: description, image: image };
  } catch (e) {
    Logger.log(`Error obteniendo info de iVoox para "${slug}": ${e}`);
    return null;
  }
}

// ===== REGISTRO PERSISTENTE =====
// Estructura: { fileId: { driveName, githubName, title, description, image,
//                          pubDate, modified, tooBig?, size? } }
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

// ===== SUBE UN ARCHIVO A GITHUB =====
function subirArchivoAGitHub(file, shaExistente, nombreGitHub) {
  const token = getGithubToken();
  const pathRelativo = `${AUDIO_FOLDER_PATH}/${nombreGitHub}`;

  let bytes = file.getBlob().getBytes();
  let contentBase64 = Utilities.base64Encode(bytes);
  bytes = null;

  const payload = {
    message: `Audio: ${nombreGitHub}`,
    content: contentBase64,
    branch: BRANCH
  };
  if (shaExistente) payload.sha = shaExistente;

  const payloadStr = JSON.stringify(payload);
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
    Logger.log(`Error subiendo ${nombreGitHub}: ${code} - ${res.getContentText('UTF-8')}`);
    return false;
  }
  return true;
}

// ===== ELIMINA UN ARCHIVO DE GITHUB =====
function eliminarArchivoDeGitHub(nombreGitHub) {
  const token = getGithubToken();
  const pathRelativo = `${AUDIO_FOLDER_PATH}/${nombreGitHub}`;

  const info = existeEnGitHub(pathRelativo);
  if (!info) {
    // Ya no existe en GitHub: nada que borrar
    return true;
  }

  const payload = {
    message: `Eliminación automática (más de un año): ${nombreGitHub}`,
    sha: info.sha,
    branch: BRANCH
  };

  const res = UrlFetchApp.fetch(apiContentsUrl(pathRelativo), {
    method: "DELETE",
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code !== 200 && code !== 204) {
    Logger.log(`Error eliminando ${nombreGitHub} de GitHub: ${code} - ${res.getContentText('UTF-8')}`);
    return false;
  }
  return true;
}

// ===== LISTA LOS ARCHIVOS DE LA CARPETA DE AUDIO EN GITHUB =====
function listarArchivosEnGitHub() {
  const token = getGithubToken();
  const res = UrlFetchApp.fetch(apiContentsUrl(AUDIO_FOLDER_PATH), {
    headers: { 'Authorization': `Bearer ${token}` },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) return [];

  const items = JSON.parse(res.getContentText('UTF-8'));
  if (!Array.isArray(items)) return [];

  return items.filter(i => i.type === 'file');
}

// ===== OBTIENE LA FECHA DEL ÚLTIMO COMMIT DE UN ARCHIVO =====
/**
 * Consulta la API de GitHub para obtener la fecha del commit más reciente
 * que tocó el archivo indicado. Es la fuente de verdad para la caducidad.
 * @param {string} nombreGitHub Nombre del archivo dentro de AUDIO_FOLDER_PATH.
 * @return {Date|null} Fecha del último commit, o null si no se pudo obtener.
 */
function obtenerFechaUltimoCommit(nombreGitHub) {
  const token = getGithubToken();
  const pathRelativo = `${AUDIO_FOLDER_PATH}/${nombreGitHub}`;
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?path=${encodeURIComponent(pathRelativo)}&per_page=1`;

  const res = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) return null;

  const commits = JSON.parse(res.getContentText('UTF-8'));
  if (!Array.isArray(commits) || commits.length === 0) return null;

  // El primer elemento es el commit más reciente que tocó este archivo
  return new Date(commits[0].commit.committer.date);
}

// ===== LIMPIEZA: ELIMINA ARCHIVOS DE GITHUB CON MÁS DE UN AÑO =====
/**
 * Recorre todos los archivos de la carpeta de audio en GitHub, consulta la
 * fecha de su último commit y elimina los que superen ANTIGUEDAD_MAXIMA_MS.
 * No depende del registro local: siempre pregunta a GitHub.
 */
function limpiarArchivosExpirados() {
  const archivos = listarArchivosEnGitHub();
  const ahora = Date.now();

  let revisados = 0;
  let eliminados = 0;
  let fallidos = 0;

  for (const archivo of archivos) {
    const fecha = obtenerFechaUltimoCommit(archivo.name);

    if (!fecha || isNaN(fecha.getTime())) {
      Logger.log(`No se pudo obtener la fecha de ${archivo.name}. Se omite.`);
      continue;
    }

    revisados++;

    if (ahora - fecha.getTime() > ANTIGUEDAD_MAXIMA_MS) {
      const ok = eliminarArchivoDeGitHub(archivo.name);
      if (ok) {
        eliminados++;
        Logger.log(`Archivo expirado eliminado: ${archivo.name} (último commit: ${fecha.toISOString()})`);
      } else {
        fallidos++;
      }
    }
  }

  Logger.log(`Limpieza: revisados ${revisados}, eliminados ${eliminados}, fallidos ${fallidos}`);
}

// ===== SUBE COMO MÁXIMO 1 ARCHIVO NUEVO POR EJECUCIÓN =====
function subirAudiosNuevosAGitHub() {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const files = folder.getFiles();
  const registro = cargarRegistro();

  let procesados = 0;
  let saltados = 0;
  let subidos = 0;
  let demasiadoGrande = 0;

  while (files.hasNext() && procesados < MAX_ARCHIVOS_POR_EJECUCION) {
    let file = files.next();
    const driveName = file.getName();

    if (!driveName.match(/\.(mp3|m4a|wav)$/i)) {
      file = null;
      continue;
    }

    const id = file.getId();
    const modified = file.getLastUpdated().getTime();
    const entrada = registro[id];

    // Si ya está registrado y no ha cambiado, saltar
    if (entrada && entrada.driveName === driveName && entrada.modified === modified) {
      saltados++;
      file = null;
      continue;
    }

    // --- Obtener slug y consultar iVoox ---
    const slug = driveName.replace(/\.[^/.]+$/, "");
    const infoIvoox = obtenerInfoIvoox(slug);

    const titulo = infoIvoox ? infoIvoox.title : slug;
    const descripcion = infoIvoox ? infoIvoox.description : '';
    const imagen = infoIvoox ? infoIvoox.image : '';

    const nombreGitHub = sanitizeFileName(titulo) + '.mp3';

    // --- Comprobar tamaño ---
    const size = file.getSize();
    if (size > LIMITE_BYTES) {
      const sizeMB = (size / 1024 / 1024).toFixed(2);
      const limiteMB = (LIMITE_BYTES / 1024 / 1024).toFixed(0);
      Logger.log(`Archivo ${driveName} (${sizeMB} MB) supera ${limiteMB} MB. Se registra sin audio.`);

      registro[id] = {
        driveName: driveName,
        githubName: nombreGitHub,
        title: titulo,
        description: descripcion,
        image: imagen,
        pubDate: file.getDateCreated().toUTCString(),
        modified: modified,
        tooBig: true,
        size: size
      };
      demasiadoGrande++;
      procesados++;
      file = null;
      continue;
    }

    // --- Subida a GitHub ---
    let shaExistente = null;
    const infoGitHub = existeEnGitHub(`${AUDIO_FOLDER_PATH}/${nombreGitHub}`);
    if (infoGitHub) shaExistente = infoGitHub.sha;

    const ok = subirArchivoAGitHub(file, shaExistente, nombreGitHub);
    if (!ok) {
      file = null;
      continue;
    }

    // --- Guardar en el registro ---
    registro[id] = {
      driveName: driveName,
      githubName: nombreGitHub,
      title: titulo,
      description: descripcion,
      image: imagen,
      pubDate: file.getDateCreated().toUTCString(),
      modified: modified
    };
    subidos++;
    procesados++;

    file = null;
  }

  guardarRegistro(registro);
  Logger.log(
    `Subidos: ${subidos} | Demasiado grandes: ${demasiadoGrande} | ` +
    `Saltados: ${saltados}`
  );
}

// ===== GENERA EL XML DEL FEED =====
function generarXMLFeed() {
  const registro = cargarRegistro();

  const entradas = Object.keys(registro).map(id => {
    return Object.assign({ id: id }, registro[id]);
  });
  entradas.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  let items = "";
  for (const e of entradas) {
    const imagenItem = (e.image && e.image.trim() !== '') ? e.image : PODCAST_IMAGE_URL;

    let item = `
    <item>
      <title>${escapeXml(e.title)}</title>
      <pubDate>${e.pubDate}</pubDate>
      <guid isPermaLink="false">${e.id}</guid>
      <itunes:author>${FEED_AUTHOR}</itunes:author>
      <itunes:image href="${imagenItem}" />`;

    if (e.description && e.description.trim() !== "") {
      item += `
      <description>${escapeXml(e.description)}</description>`;
    } else if (e.tooBig) {
      item += `
      <description>Episodio no alojado por superar el límite de tamaño</description>`;
    }

    if (!e.tooBig) {
      const pathRelativo = `${AUDIO_FOLDER_PATH}/${encodeURIComponent(e.githubName)}`;
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

// ===== SUBE EL FEED A GITHUB =====
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

  const blob = Utilities.newBlob(contenidoXML, 'text/xml', 'feed-podcasts.xml');
  let contenidoBase64 = Utilities.base64Encode(blob.getBytes());

  const payload = {
    message: "Actualización automática del feed RSS de Podcasts",
    content: contenidoBase64,
    branch: BRANCH
  };
  if (sha) payload.sha = sha;

  const payloadStr = JSON.stringify(payload);
  contenidoBase64 = null;

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
function EJECUTAR_ACTUALIZAR_TODO() {
  limpiarArchivosExpirados();  // Primero limpiamos los que ya cumplieron un año
  subirAudiosNuevosAGitHub();
  subirFeedAGitHub();
}
