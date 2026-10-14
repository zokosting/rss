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

const PODCAST_IMAGE_URL = "https://lh3.googleusercontent.com/d/10qdS-dL2FK4JWCnLfDDmcybsxFrksRqy";

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

// ===== EXTRAE LA URL DE DESCARGA (CON TOKEN) DESDE EL HTML =====
/**
 * Busca en el HTML de la página del episodio el enlace de descarga directa.
 * El enlace está dentro de un script de JavaScript con el patrón .downloadlink').
 * @param {string} html Contenido HTML de la página del episodio.
 * @return {string|null} URL de descarga con token, o null si no se encuentra.
 */
function obtenerUrlDescargaConToken(html) {
  // Busca la línea que contiene .downloadlink') y extrae la URL que le sigue.
  // Patrón observado: document.write('<a href="https://www.ivoox.com/listen_md_181881572_1.mp3?t=...">Descargar</a>');
  const regex = /\.downloadlink'\)[^;]*?['"](https:\/\/www\.ivoox\.com\/listen_md_\d+_1\.mp3\?[^'"]+)['"]/i;
  const match = html.match(regex);
  if (match) {
    Logger.log(`URL de descarga con token encontrada: ${match[1]}`);
    return match[1];
  }

  // Fallback: buscar directamente cualquier URL listen_md con token
  const fallbackRegex = /https:\/\/www\.ivoox\.com\/listen_md_\d+_1\.mp3\?[^'"\s]+/i;
  const fallbackMatch = html.match(fallbackRegex);
  if (fallbackMatch) {
    Logger.log(`URL de descarga encontrada (fallback): ${fallbackMatch[0]}`);
    return fallbackMatch[0];
  }

  Logger.log('No se encontró la URL de descarga en el HTML.');
  return null;
}

// ===== LEE LA URL DESDE UN GOOGLE DOC =====
function obtenerUrlDesdeGoogleDoc(file) {
  try {
    const doc = DocumentApp.openById(file.getId());
    const body = doc.getBody().getText();

    // Busca una URL en el texto del documento
    const regex = /(https?:\/\/www\.ivoox\.com\/[^\s]+)/;
    const match = body.match(regex);

    if (match) {
      Logger.log(`URL encontrada en el Doc: ${match[1]}`);
      return match[1];
    }
    Logger.log(`No se encontró URL en el documento: ${file.getName()}`);
    return null;
  } catch (e) {
    Logger.log(`Error al leer el Google Doc "${file.getName()}": ${e}`);
    return null;
  }
}

// ===== SUBE UN BLOB A GITHUB =====
function subirBlobAGitHub(blob, nombreGitHub, shaExistente) {
  const token = getGithubToken();
  const pathRelativo = `${AUDIO_FOLDER_PATH}/${nombreGitHub}`;

  let bytes = blob.getBytes();
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

// ===== SUBE UN ARCHIVO A GITHUB (para MP3 locales) =====
function subirArchivoAGitHub(file, shaExistente, nombreGitHub) {
  return subirBlobAGitHub(file.getBlob(), nombreGitHub, shaExistente);
}

// ===== ELIMINA UN ARCHIVO DE GITHUB =====
function eliminarArchivoDeGitHub(nombreGitHub) {
  const token = getGithubToken();
  const pathRelativo = `${AUDIO_FOLDER_PATH}/${nombreGitHub}`;

  const info = existeEnGitHub(pathRelativo);
  if (!info) {
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

  return new Date(commits[0].commit.committer.date);
}

// ===== LIMPIEZA: ELIMINA ARCHIVOS DE GITHUB CON MÁS DE UN AÑO =====
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

// ===== PROCESA UN GOOGLE DOC (descarga el audio y lo sube a GitHub) =====
function procesarGoogleDoc(file, registro, id, modified) {
  Logger.log(`Procesando Google Doc: ${file.getName()}`);

  // 1. Obtener la URL pública desde el contenido del Doc
  const urlPublica = obtenerUrlDesdeGoogleDoc(file);
  if (!urlPublica) {
    Logger.log(`Saltando Google Doc sin URL: ${file.getName()}`);
    return false;
  }

  // 2. Obtener información del episodio (título, descripción, imagen) desde iVoox
  const slug = urlPublica.replace('https://www.ivoox.com/', '').replace('.html', '');
  const infoIvoox = obtenerInfoIvoox(slug);

  const titulo = infoIvoox ? infoIvoox.title : slug;
  const descripcion = infoIvoox ? infoIvoox.description : '';
  const imagen = infoIvoox ? infoIvoox.image : '';

  const nombreGitHub = sanitizeFileName(titulo) + '.mp3';

  // 3. Obtener la URL de descarga con token desde la página
  const resPagina = UrlFetchApp.fetch(urlPublica, { muteHttpExceptions: true });
  if (resPagina.getResponseCode() !== 200) {
    Logger.log(`Error al obtener la página: ${resPagina.getResponseCode()}`);
    return false;
  }

  const htmlPagina = resPagina.getContentText('UTF-8');
  const urlDescarga = obtenerUrlDescargaConToken(htmlPagina);

  if (!urlDescarga) {
    Logger.log(`No se pudo obtener la URL de descarga para: ${urlPublica}`);
    return false;
  }

  // 4. Descargar el MP3
  Logger.log(`Descargando audio desde: ${urlDescarga}`);
  const resAudio = UrlFetchApp.fetch(urlDescarga, {
    headers: { 'Referer': 'https://www.ivoox.com/' },
    muteHttpExceptions: true
  });

  if (resAudio.getResponseCode() !== 200) {
    Logger.log(`Error al descargar el audio: ${resAudio.getResponseCode()}`);
    return false;
  }

  const audioBlob = resAudio.getBlob();

  // 5. Comprobar tamaño
  const size = audioBlob.getBytes().length;
  if (size > LIMITE_BYTES) {
    const sizeMB = (size / 1024 / 1024).toFixed(2);
    const limiteMB = (LIMITE_BYTES / 1024 / 1024).toFixed(0);
    Logger.log(`Audio de ${file.getName()} (${sizeMB} MB) supera ${limiteMB} MB. Se registra sin audio.`);

    registro[id] = {
      driveName: file.getName(),
      githubName: nombreGitHub,
      title: titulo,
      description: descripcion,
      image: imagen,
      pubDate: file.getDateCreated().toUTCString(),
      modified: modified,
      tooBig: true,
      size: size
    };
    return true; // Registrado como demasiado grande
  }

  // 6. Subir a GitHub
  let shaExistente = null;
  const infoGitHub = existeEnGitHub(`${AUDIO_FOLDER_PATH}/${nombreGitHub}`);
  if (infoGitHub) shaExistente = infoGitHub.sha;

  const ok = subirBlobAGitHub(audioBlob, nombreGitHub, shaExistente);
  if (!ok) {
    return false;
  }

  // 7. Registrar
  registro[id] = {
    driveName: file.getName(),
    githubName: nombreGitHub,
    title: titulo,
    description: descripcion,
    image: imagen,
    pubDate: file.getDateCreated().toUTCString(),
    modified: modified
  };

  Logger.log(`Google Doc procesado correctamente: ${file.getName()} -> ${nombreGitHub}`);
  return true;
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
  let googleDocsProcesados = 0;

  while (files.hasNext() && procesados < MAX_ARCHIVOS_POR_EJECUCION) {
    let file = files.next();
    const driveName = file.getName();
    const mimeType = file.getMimeType();

    // Detectar si es un MP3 o un Google Doc
    const esMP3 = mimeType === 'audio/mpeg' || driveName.match(/\.(mp3|m4a|wav)$/i);
    const esGoogleDoc = mimeType === 'application/vnd.google-apps.document';

    if (!esMP3 && !esGoogleDoc) {
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

    // --- Procesar según tipo ---
    if (esGoogleDoc) {
      const ok = procesarGoogleDoc(file, registro, id, modified);
      if (ok) {
        googleDocsProcesados++;
        procesados++;
      }
      file = null;
      continue;
    }

    // --- Lógica para MP3 (la que ya tenías) ---
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
    `Subidos: ${subidos} | Google Docs procesados: ${googleDocsProcesados} | ` +
    `Demasiado grandes: ${demasiadoGrande} | Saltados: ${saltados}`
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
  limpiarArchivosExpirados();
  subirAudiosNuevosAGitHub();
  subirFeedAGitHub();
}