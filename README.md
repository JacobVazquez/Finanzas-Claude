# Finanzas Claude 💰

Aplicación web de finanzas personales construida con HTML, CSS y JavaScript vanilla, con Firebase como backend.

## Tecnologías

- **Frontend:** HTML5, CSS3, JavaScript (ES Modules)
- **Autenticación:** Firebase Authentication (email/password)
- **Base de datos:** Cloud Firestore
- **Hosting:** Firebase Hosting
- **Gráficas:** Chart.js
- **Sin frameworks:** No React, No Vue, No Angular — 100% Vanilla JS

## Estructura de Archivos

```
/
├── public/
│   ├── index.html          # SPA principal
│   ├── styles.css          # Estilos modernos
│   ├── app.js              # Punto de entrada, navegación
│   ├── firebase-config.js  # Configuración Firebase (tú la llenas)
│   ├── auth.js             # Registro, login, logout
│   ├── firestore.js        # CRUD base para Firestore
│   ├── accounts.js         # Módulo de cuentas
│   ├── transactions.js     # Módulo de movimientos
│   ├── categories.js       # Categorías de gasto/ingreso
│   ├── goals.js            # Metas de ahorro
│   ├── debts.js            # Deudas
│   ├── dashboard.js        # KPIs y resumen
│   ├── charts.js           # Gráficas Chart.js
│   ├── import-export.js    # Exportar/importar datos
│   └── utils.js            # Utilidades comunes
├── firestore.rules         # Reglas de seguridad Firestore
├── firebase.json           # Configuración Firebase CLI
├── .firebaserc.example     # Ejemplo de vinculación de proyecto
└── README.md
```

## Configuración Paso a Paso

### 1. Crear Proyecto Firebase

1. Ve a [https://console.firebase.google.com](https://console.firebase.google.com)
2. Haz clic en **"Agregar proyecto"**
3. Ponle un nombre (ej. `finanzas-personal`)
4. Puedes deshabilitar Google Analytics si no lo necesitas
5. Haz clic en **"Crear proyecto"**

### 2. Activar Authentication (Email/Password)

1. En el panel izquierdo, ve a **Build → Authentication**
2. Haz clic en **"Comenzar"**
3. En la pestaña **"Sign-in method"**, selecciona **"Correo electrónico/contraseña"**
4. Activa el primer toggle (Email/Password) y guarda

### 3. Crear Cloud Firestore

1. En el panel izquierdo, ve a **Build → Firestore Database**
2. Haz clic en **"Crear base de datos"**
3. Selecciona **"Comenzar en modo de producción"** (las reglas del archivo `firestore.rules` las manejaremos via CLI)
4. Elige la región más cercana (ej. `us-central1` o `southamerica-east1` para LATAM)
5. Haz clic en **"Habilitar"**

### 4. Obtener Configuración Firebase

1. En el panel de tu proyecto, ve a **Configuración del proyecto** (ícono de engranaje ⚙️)
2. Baja hasta **"Tus apps"** y haz clic en el ícono **`</>`** (Web)
3. Registra la app con un nombre (ej. `finanzas-web`)
4. Copia el objeto `firebaseConfig` que aparece

### 5. Configurar `firebase-config.js`

Abre `public/firebase-config.js` y reemplaza los valores:

```javascript
export const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "mi-proyecto.firebaseapp.com",
  projectId: "mi-proyecto",
  storageBucket: "mi-proyecto.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### 6. Instalar Firebase CLI

```bash
npm install -g firebase-tools
```

### 7. Iniciar Sesión en Firebase

```bash
firebase login
```

Esto abrirá el navegador para autenticarte con tu cuenta de Google.

### 8. Vincular tu Proyecto

```bash
firebase use --add
```

Selecciona tu proyecto de la lista y asígnale un alias (ej. `default`).

Esto creará el archivo `.firebaserc` (que está en `.gitignore` para no compartir tu project ID).

### 9. Desplegar la Aplicación

```bash
firebase deploy --only hosting
```

Después de desplegar, Firebase te dará una URL como:
`https://mi-proyecto.web.app`

### 10. Publicar Reglas de Seguridad

```bash
firebase deploy --only firestore:rules
```

Esto aplica las reglas del archivo `firestore.rules` que aseguran que cada usuario solo pueda ver sus propios datos.

### 11. Probar Localmente

```bash
firebase serve --only hosting
```

Abre `http://localhost:5000` en tu navegador.

> **Nota:** Necesitas servir desde Firebase (no abrir el HTML directamente) porque usa ES Modules y Firebase necesita HTTPS/localhost.

## Características

- ✅ Autenticación segura con Firebase
- ✅ Dashboard con KPIs: ingresos, egresos, balance, tasa de ahorro, patrimonio neto
- ✅ Cuentas: efectivo, débito, bancaria, digital
- ✅ Movimientos: ingresos, egresos, transferencias, pagos de deuda, aportaciones a metas
- ✅ Categorías personalizables
- ✅ Metas de ahorro con barra de progreso
- ✅ Deudas con seguimiento de pagos
- ✅ 6 tipos de gráficas (barras, dona, líneas)
- ✅ Exportar/importar datos en JSON y CSV
- ✅ Diseño responsive (móvil y escritorio)
- ✅ Modo oscuro preparado con variables CSS
- ✅ Todos los montos en centavos internamente (evita errores de punto flotante)

## Mejoras Futuras Recomendadas

- [ ] Modo oscuro completo
- [ ] Notificaciones push para vencimiento de deudas
- [ ] Presupuestos mensuales por categoría
- [ ] Escaneo de recibos con OCR
- [ ] Reportes mensuales por email
- [ ] Soporte para múltiples monedas
- [ ] Sincronización con bancos via Open Banking
- [ ] App móvil con Capacitor/Ionic
- [ ] Modo offline con IndexedDB + sync
- [ ] Compartir cuentas entre usuarios (familia)

## Seguridad

- Cada usuario solo puede leer y escribir sus propios datos (reglas Firestore)
- No se almacenan contraseñas (manejo completo por Firebase Auth)
- El `firebase-config.js` con tus claves **sí puede estar en el repositorio público** — Firebase tiene restricciones de dominio configurables en la consola
- Para mayor seguridad, configura **"Dominios autorizados"** en Firebase Auth

## Licencia

MIT — Úsala, modifícala y compártela libremente.