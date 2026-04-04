# The Content Edit — Setup de Vercel

## Estructura del proyecto

```
the-content-edit/
├── api/
│   ├── webhook.js          ← Recibe pagos de Lemon Squeezy
│   ├── setup.js            ← Maneja el setup flow del usuario
│   └── widget/
│       └── [widgetId].js   ← Sirve los posts de Notion al widget
├── public/
│   ├── index.html          ← Landing page
│   ├── setup.html          ← Página de setup del usuario
│   └── embed.html          ← El widget embebible en Notion
├── vercel.json
├── package.json
└── README.md
```

---

## 1. Variables de entorno en Vercel

Ve a tu proyecto en Vercel → Settings → Environment Variables y agrega:

| Variable | Dónde conseguirla |
|---|---|
| `RESEND_API_KEY` | resend.com → API Keys |
| `LEMON_SQUEEZY_WEBHOOK_SECRET` | Lemon Squeezy → Settings → Webhooks |
| `LS_PRO_VARIANT_ID` | Lemon Squeezy → tu producto → Variants → ID |
| `ENCRYPTION_KEY` | genera con: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NEXT_PUBLIC_BASE_URL` | tu dominio, ej: `https://thecontentedit.co` |
| `KV_REST_API_URL` | se llena automático al conectar Vercel KV |
| `KV_REST_API_TOKEN` | se llena automático al conectar Vercel KV |

---

## 2. Conectar Vercel KV (base de datos)

1. En tu proyecto de Vercel → Storage → Create Database → KV
2. Dale un nombre (ej: `tce-db`) y crea
3. Las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN` se agregan automáticamente

---

## 3. Configurar Lemon Squeezy

1. Crea una cuenta en lemonsqueezy.com
2. Crea tu tienda → New Product → "The Content Edit Pro"
3. Precio: $449 MXN (o USD equivalente)
4. En Settings → Webhooks → Add webhook:
   - URL: `https://tudominio.co/api/webhook`
   - Events: `order_created`
   - Copia el signing secret → `LEMON_SQUEEZY_WEBHOOK_SECRET`
5. Copia el Variant ID de tu producto → `LS_PRO_VARIANT_ID`

---

## 4. Configurar Resend (emails)

1. Crea cuenta en resend.com (gratis hasta 3,000 emails/mes)
2. Agrega tu dominio y verifica el DNS
3. API Keys → Create API Key → copia → `RESEND_API_KEY`
4. En `api/webhook.js` cambia el from: `hola@tudominio.co`

---

## 5. Deploy

```bash
# Instala Vercel CLI
npm i -g vercel

# En la carpeta del proyecto
vercel

# Para producción
vercel --prod
```

---

## Flujo completo del usuario

1. Usuario compra en Lemon Squeezy
2. Lemon Squeezy llama a `POST /api/webhook`
3. Se genera license key + setup token → guardados en KV
4. Se manda email con `https://tudominio.co/setup?token=XXX`
5. Usuario va al setup link → página de setup
6. Ingresa Notion Integration Token + Database ID
7. `POST /api/setup` valida credenciales y genera `widgetId`
8. Usuario recibe su embed URL: `https://tudominio.co/embed/WIDGET_ID`
9. Pega en Notion como `/embed` → el widget carga sus posts en tiempo real

---

## Seguridad

- Los Notion tokens se cifran con AES-256-GCM antes de guardarse en KV
- El webhook de Lemon Squeezy se verifica con HMAC-SHA256
- Cada usuario tiene un widgetId único e impredecible (base64url de 16 bytes)
- Los setup tokens expiran a los 30 días si no se activan
