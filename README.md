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

El menú de compartir es independiente del envío por Gmail. Escribir el correo del receptor no activa por sí solo el envío automático.

### Correo automático con Gmail

En **Ajustes > Correo**, el remitente inicial es `garitafernandez4@gmail.com` y el automático está **desactivado**. No se ha conectado esa cuenta ni se han enviado correos al instalar esta función.

1. Activa la verificación en dos pasos de Google y crea una [contraseña de aplicación](https://support.google.com/accounts/answer/185833?hl=es), si tu cuenta lo permite. No uses tu contraseña habitual ni la pegues en el chat.
2. Escribe esa contraseña solo en **Ajustes > Correo**, confirma el remitente, el nombre y el PDF predeterminado (carta, ticket 58 mm o ticket 80 mm). Guarda.
3. Pulsa **Verificar conexión sin enviar**. Comprueba autenticación/TLS con Gmail, no la entrega a destinatarios.
4. Opcionalmente, pulsa **Enviar prueba a mi Gmail** y confirma el destino. Esa prueba no incluye facturas ni datos de clientes. Revisa Recibidos y Spam. Hay 30 segundos de espera entre pruebas/verificaciones.
5. Marca la autorización y pulsa **Activar envío automático**.

El disparador es la consulta de estado existente: cuando la app consulta Hacienda y obtiene `aceptado` para un comprobante de **producción**, intenta enviar un correo al receptor guardado con **tres adjuntos independientes**: PDF, XML firmado y XML de aceptación. No hay sondeo autónomo de Hacienda ni envío masivo al activar. Una consulta posterior de una factura ya aceptada también puede iniciar su primer intento. Las facturas de sandbox y los documentos comerciales nunca se envían por este flujo.

El destino se toma del correo guardado en la factura o de su XML firmado, no del directorio de clientes modificado posteriormente. Si ambos difieren, falta un correo válido o falta alguno de los adjuntos, el envío se bloquea. Los dos XML se verifican contra la clave fiscal y se adjuntan sin reserializarlos. El paquete tiene un límite conservador de 15 MB.

Cada factura muestra **Correo al cliente**, con remitente, destinatario, estado e intentos. Permite enviar manualmente aunque el automático esté desactivado, siempre que la conexión esté verificada. La primera consulta crea un único intento automático con exclusión en Postgres; las consultas concurrentes no lo duplican. Los fallos requieren un reintento explícito desde la factura. Para reenviar un mensaje ya aceptado por Gmail o cuyo resultado sea incierto, se exige confirmación y el identificador del intento vigente.

**Aceptado por Gmail no significa entregado ni leído.** Revisa los rebotes en la cuenta remitente. Un corte de conexión después de iniciar SMTP se conserva como resultado incierto; no se reenvía automáticamente. Los intentos interrumpidos en preparación o envío se consideran fallidos o inciertos tras cinco minutos, respectivamente. Un fallo de correo nunca revierte la aceptación fiscal.

Guardar la configuración desactiva el automático e invalida la verificación. Al cambiar de cuenta sin introducir su contraseña se elimina la credencial anterior. La contraseña se cifra con AES-256-GCM usando `HACIENDA_ENCRYPTION_KEY` (32 bytes Base64), exigida también en desarrollo para correo. Las API nunca devuelven la contraseña ni errores SMTP sin filtrar. La conexión usa exclusivamente `smtp.gmail.com:465`, TLS con certificado válido y sin acceso a archivos/URLs desde los adjuntos. Esta primera integración utiliza Gmail; una cuenta con dominio propio alojada en Google Workspace puede utilizar el mismo servidor, sujeta a las políticas de Google.

Las tablas `invoice_email_settings`, `invoice_email_deliveries` e `invoice_email_attempts` se crean de forma aditiva al usar la función. No se modifican certificados, credenciales de Hacienda, correos tributarios ni facturas existentes para activar el remitente.

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

Pruebas del paquete de entrega y correo (datos simulados y MIME local, sin conectar con Gmail, enviar facturas reales ni utilizar la base de datos de producción):

```bash
npm test
```

## Publicación

El proyecto está preparado para Next.js en Vercel. La integración de Neon proporciona `DATABASE_URL` automáticamente en los ambientes conectados.
