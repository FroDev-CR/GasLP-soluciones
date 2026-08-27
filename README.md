# GAS LP SOLUCIONES

Aplicación web móvil para administrar clientes, agenda de instalaciones, catálogo, inventario y borradores de facturación electrónica de GAS LP SOLUCIONES en Costa Rica.

## Funciones

- Panel diario optimizado para teléfonos.
- Agenda de instalaciones y entregas.
- Agenda condicional por tipo de trabajo y cilindros disponibles en inventario.
- Directorio de clientes con los tipos de identificación definidos por el Ministerio de Hacienda de Costa Rica.
- Catálogo de cilindros, repuestos y servicios.
- Inventario con alertas de existencias bajas.
- Documentos comerciales libres, separados de los comprobantes tributarios.
- Moneda predeterminada en colones costarricenses (CRC).
- Generación de Factura Electrónica, Tiquete Electrónico y Nota de Crédito v4.4 con actividad económica, CABYS e IVA.
- Firma XAdES-EPES, envío al API de Hacienda y consulta del estado.
- PDF fiscal con QR, XML firmado, respuesta de Hacienda y respaldo fiscal completo en ZIP.
- Preparación del envío al cliente con PDF (carta o ticket), XML firmado y XML de aceptación; los tres archivos se comparten juntos o se descargan en un ZIP.
- Configuración persistente del negocio, obligado tributario y asociado autorizado.

## Entrega al cliente

En una factura aceptada, elige carta o ticket y pulsa **Preparar envío PDF + XML**. La app comprueba que existan el PDF, el XML firmado y la respuesta de aceptación de Hacienda, y que ambos XML correspondan a la clave del comprobante. Los XML se conservan sin modificar sus bytes ni volver a firmarlos.

Cuando los archivos estén listos, **Compartir PDF + XML** abre el menú del dispositivo. Si el navegador solo admite un ZIP, se comparte el paquete completo; si tampoco admite ZIP, utiliza **Descargar ZIP (PDF + XML)** y adjúntalo al correo o chat del cliente. No se abre WhatsApp con un mensaje de texto como sustituto de los archivos. Cancelar el menú o descargar el ZIP no confirma una entrega.

Si falta la respuesta XML, usa **Consultar respuesta de Hacienda** y vuelve a preparar el envío. Un XML faltante, inválido o de otra factura bloquea el paquete; nunca se omite silenciosamente. Los documentos comerciales solo tienen PDF, no XML fiscal.

**No hay envío automático por correo:** escribir el correo del receptor en la factura no envía un mensaje. Para automatizarlo se necesita configurar un servicio de correo y un remitente autorizado; el flujo actual entrega los adjuntos a la aplicación de correo o mensajería que el usuario elija.

## Seguridad

- La aplicación exige usuario y contraseña antes de mostrar información. El acceso inicial es `adminGASLP` / `Admin123` y debe cambiarse desde `Ajustes > Acceso`.
- La contraseña se guarda con scrypt y sal aleatoria; nunca se almacena en texto plano ni viaja de vuelta al navegador.
- La sesión es una cookie `httpOnly` firmada que caduca a los 30 días y se invalida al cambiar la contraseña.
- El inicio de sesión bloquea temporalmente tras 8 intentos fallidos seguidos.
- Las credenciales del API, el PIN y el certificado `.p12` se cifran con AES-256-GCM.
- Pruebas y producción usan perfiles de credenciales y consecutivos físicamente separados.
- Los secretos se cargan únicamente desde `Ajustes > Hacienda y facturación` y nunca se devuelven al navegador.

## Activación de Hacienda

Antes de emitir en producción se deben completar y confirmar dentro de la aplicación:

1. Método de facturación actualizado en TRIBU-CR como desarrollo propio/interno.
2. Último consecutivo utilizado de FE, TE y NC para la sucursal y terminal configuradas.
3. Usuario y contraseña **de producción** del API de comprobantes.
4. Certificado `.p12` **de producción** y su PIN.
5. Confirmación explícita de que los siguientes comprobantes serán reales.

La primera validación debe realizarse en `Pruebas (sandbox)`. Las credenciales cuyo usuario contiene `@stag` son rechazadas por el formulario de producción. Un documento comercial nunca se envía a Hacienda; un borrador electrónico no tiene validez hasta que Hacienda muestre el estado `aceptado`.

## Desarrollo

Requiere Node.js 22 o posterior y una base de datos Postgres compatible con Neon.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Configura `DATABASE_URL` y `HACIENDA_ENCRYPTION_KEY` en `.env.local`. La cuenta de acceso no usa variables de entorno: se crea sola en la base de datos la primera vez y se administra desde `Ajustes > Acceso`. Para verificar la versión de producción:

```bash
npm run build
```

Pruebas del paquete de entrega (datos simulados, sin enviar facturas reales):

```bash
npm test
```

## Publicación

El proyecto está preparado para Next.js en Vercel. La integración de Neon proporciona `DATABASE_URL` automáticamente en los ambientes conectados.
