function formatDateToInputFormat(fecha) {
    const date = new Date(fecha);
    const year = date.getFullYear();
    const month = ("0" + (date.getMonth() + 1)).slice(-2);
    const day = ("0" + date.getDate()).slice(-2);
    return `${year}-${month}-${day}`;
}
function openEditModal(id, nombre, codigo_barras,tamano, color, descripcion, reg_invima, presentacion, proovedor, stock_minimo) {
    document.getElementById("edit_id_producto").value = id;
    document.getElementById("edit_nombre").value = nombre;
    document.getElementById("edit_codigo_barras").value = codigo_barras;
    document.getElementById("edit_tamano").value = tamano;
    document.getElementById("edit_color").value = color;
    document.getElementById("edit_descripcion").value = descripcion;
    document.getElementById("edit_reg_invima").value = reg_invima;
    document.getElementById("edit_presentacion").value = presentacion;
    document.getElementById("edit_proovedor").value = proovedor;
    document.getElementById("edit_stock_minimo").value = stock_minimo;

    // ACTUALIZA LA ACCIÓN DEL FORMULARIO PARA QUE ENVÍE EL ID CORRECTO
    document.querySelector("#editModal form").action = `/products/update/${id}`;
}
function openIncreaseQuantityModal(id) {
    document.getElementById("id_productos").value = id;
    // ACTUALIZA LA ACCIÓN DEL FORMULARIO PARA QUE ENVÍE EL ID CORRECTO
    document.querySelector("#cantidadmasModal form").action = `/products/updatequantity/${id}`;
}
function openMinusQuantityModal(id) {
    document.getElementById("id_productos").value = id;
    // ACTUALIZA LA ACCIÓN DEL FORMULARIO PARA QUE ENVÍE EL ID CORRECTO
    document.querySelector("#cantidadmenosModal form").action = `/products/updatequantityminus/${id}`;
}