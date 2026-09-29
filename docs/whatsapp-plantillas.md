# Plantillas de WhatsApp (Meta Business Manager → WhatsApp → Message templates)

Categoría: **Utility** · Idioma: **Spanish (es)**. Los nombres deben coincidir con los secrets `WA_TEMPLATE_ADMIN` y `WA_TEMPLATE_LISTO`.

## 1. `aviso_admin_mumi`
Cuerpo:
```
Atención requerida en un pedido. Cliente: {{1}}. Resumen: {{2}}. Escríbele desde tu WhatsApp; para reactivar el bot responde: reanudar {{1}}
```
Ejemplos: {{1}} = 573001234567 · {{2}} = Pedido para evento de 30 personas, sin azúcar.

## 2. `pedido_listo_mumi`
Cuerpo:
```
Pedido #{{1}} listo para entregar. Cliente: {{2}} ({{3}}). Dirección: {{4}}. Pago: {{5}}
```
Ejemplos: {{1}} = 12 · {{2}} = María Pérez · {{3}} = 3001234567 · {{4}} = Cra 19d #21-35 · {{5}} = COBRAR $34.000 (Efectivo)

Botones (tipo **Quick reply**, en este orden):
1. `📦 Recogido`
2. `✅ Entregado`

Los identificadores de pedido viajan como payload al enviar; no se configuran en Meta.

## Secrets en Supabase (Edge Functions → Secrets)
`WA_TEMPLATE_ADMIN=aviso_admin_mumi` · `WA_TEMPLATE_LISTO=pedido_listo_mumi`
Mientras no estén aprobadas (o los secrets vacíos) el sistema envía mensajes normales, que solo llegan dentro de las 24 h posteriores al último mensaje del destinatario.
