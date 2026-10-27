// ⚠️ AL CLONAR ESTE REPOSITORIO EN UN EQUIPO NUEVO sigue las instrucciones del README para aplicar sparse-checkout para no descargar mp3.

// Función auxiliar para inspeccionar el registro desde los logs.
// Depende de cargarRegistro(), definida en el archivo principal.
function verRegistro() {
  const registro = cargarRegistro();
  const entradas = Object.keys(registro).map(id => {
    return Object.assign({ fileId: id }, registro[id]);
  });

  entradas.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  Logger.log(`Total de audios registrados: ${entradas.length}\n`);

  entradas.forEach((e, i) => {
    Logger.log(
      `#${i + 1}\n` +
      `  Título:        ${e.title}\n` +
      `  Nombre en GH:  ${e.githubName || '(no subido)'}\n` +
      `  Nombre Drive:  ${e.driveName || '(no registrado)'}\n` +
      `  PubDate:       ${e.pubDate}\n` +
      `  Modificado:    ${new Date(e.modified).toISOString()}\n` +
      `  >100 MB:       ${e.tooBig ? 'SÍ (' + (e.size/1024/1024).toFixed(2) + ' MB)' : 'no'}\n` +
      `  FileId:        ${e.fileId}\n` +
      `----------------------------------------`
    );
  });
}

// ===== ELIMINA UNA ENTRADA CONCRETA DEL REGISTRO =====
function eliminarEntradaRegistro(fileId) {
  const registro = cargarRegistro();
  if (registro[fileId]) {
    const titulo = registro[fileId].title || '(sin título)';
    delete registro[fileId];
    guardarRegistro(registro);
    Logger.log(`Entrada eliminada del registro: ${titulo} (${fileId})`);
  } else {
    Logger.log(`No se encontró la entrada con fileId: ${fileId}`);
  }
}

// Detectar entradas huérfanas automáticamente
function limpiarRegistroHuerfanos() {
  const registro = cargarRegistro();
  let eliminados = 0;

  for (const id of Object.keys(registro)) {
    const e = registro[id];
    if (e.archiveUrl) continue; // Está en Archive, OK
    if (e.tooBig) continue;     // Registrado como grande sin audio, OK
    if (!e.githubName) continue;

    const info = existeEnGitHub(`${AUDIO_FOLDER_PATH}/${e.githubName}`);
    if (!info) {
      Logger.log(`Huérfano: "${e.title}" (${id}) apunta a ${e.githubName} que no existe en GitHub.`);
      delete registro[id];
      eliminados++;
    }
  }

  guardarRegistro(registro);
  Logger.log(`Entradas huérfanas eliminadas: ${eliminados}`);
}

// Uso de Depuración:
function eliminarUnaEntradaRegistro() {
  eliminarEntradaRegistro('1yMxtFvYvj41nG_cEO7mWRxkfzbKs98yd');
}
