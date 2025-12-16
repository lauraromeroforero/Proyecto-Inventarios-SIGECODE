const helpers = {}

helpers.formatFecha = (fecha) => {
    // Convertir la fecha de string ISO a objeto Date
    const date = new Date(fecha);

    const localDate = new Date(date.getTime());

    // Devolver la fecha en el formato deseado
    return localDate.toLocaleDateString('es-CO', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });  // Ejemplo: 13 de noviembre de 2024
};

helpers.formatHora = (fecha) => {
    const date = new Date(fecha);

    const localDate = new Date(date.getTime());

    return localDate.toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
};

// Helper para formatear las fechas al formato 'YYYY-MM-DD'
helpers.formatDateToInputFormat = function (date) {
    if (!date) return '';  // Si la fecha es inválida, retorna una cadena vacía

    const d = new Date(date);
    const year = d.getFullYear();
    const month = ("0" + (d.getMonth() + 1)).slice(-2);  // Agrega un 0 al mes si es menor que 10
    const day = ("0" + d.getDate()).slice(-2);  // Agrega un 0 al día si es menor que 10
    return `${year}-${month}-${day}`;  // Devuelve el formato de fecha 'YYYY-MM-DD'
}

module.exports = helpers;