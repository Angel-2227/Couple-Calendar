# 💜 Nosotros — Calendario de Pareja

App de horarios compartidos para Juan y Greisi.

---

## 📁 Estructura de archivos

```
nosotros/
├── index.html                ← Página principal
├── css/
│   └── styles.css            ← Todos los estilos (mobile-first)
├── js/
│   ├── firebase-config.js    ← Configuración Firebase (ya tiene tu config)
│   └── app.js                ← Lógica completa de la app
├── firestore.rules           ← Reglas de seguridad (sube a Firebase Console)
├── firestore.indexes.json    ← Índices de Firestore
├── firebase.json             ← Configuración Firebase CLI
└── README.md
```

---

## 🔥 Qué cambió vs la versión anterior

### Nueva estructura de secciones:
1. **Juntos** — Vista del día con los bloques de ambos, zonas de solapamiento y tiempo libre en verde
2. **Mi horario** — Solo tus bloques y eventos del día (editable)
3. **Planes y citas** — Listado de eventos de una sola vez (citas, salidas, etc.)
4. **Notificaciones** — Alertas cuando el otro agrega algo

### Concepto de bloques vs eventos:
- **Bloque (horario fijo)** → Va en `schedules`. Se repite semanalmente. Ej: Cálculo II lunes y miércoles 7-9am
- **Evento/plan** → Va en `events`. Ocurre una sola vez. Ej: Cita el viernes 15 a las 7pm

---

## 🔧 Configuración necesaria

### 1. Tu Firebase ya está configurado
El archivo `js/firebase-config.js` ya tiene tu config del proyecto `couple-calendar-60cb9`.

### 2. Actualizar reglas de Firestore

**Opción A — Firebase CLI:**
```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

**Opción B — Manual en consola:**
1. Ve a Firestore → Reglas
2. Pega el contenido de `firestore.rules`
3. Publica

### 3. Índices necesarios

Los índices actuales que ya tienes son suficientes. Hay un índice nuevo:
- Colección: `schedules` / Campo 1: `ownerId` ASC / Campo 2: `createdAt` ASC

Si aún no existe, créalo en Firebase Console → Firestore → Índices → Crear índice.

### 4. Subir a Cloudflare Pages
- Sube todos los archivos manteniendo la estructura de carpetas (`css/`, `js/`)
- Archivo raíz: `index.html`
- Sin build step

---

## 📱 Cómo usar la app

### Primer uso (cada uno):
1. Entra con tu cuenta de Google
2. Ve a **Mi horario** → toca el **+ Agregar**
3. Agrega tus clases/trabajo/actividades como bloques fijos con los días y horas que se repiten
4. Repite para cada bloque distinto (Ej: Cálculo martes y jueves, Inglés viernes)

### Ver tiempo libre juntos:
1. Entra a **Juntos**
2. Navega los días con el selector de días arriba
3. Los bloques **azules** son de Juan, **rosados** de Greisi
4. Los **verdes** son horas donde los dos están libres

### Agregar una cita:
1. Ve a **Planes y citas** → **+ Nuevo**
2. Elige tipo "Cita 💜", pon fecha, hora y lugar
3. Activa "Notificar a mi pareja" para que le llegue una notificación

---

## 🗃️ Estructura de datos en Firestore

### `schedules/{id}` — Bloques fijos semanales
```json
{
  "title": "Cálculo II",
  "type": "university",
  "startTime": "07:00",
  "endTime": "09:00",
  "days": [2, 4],
  "startDate": "2025-01-20",
  "endDate": "2025-06-30",
  "notes": "Salón 304",
  "ownerEmail": "juanrubio2277@gmail.com",
  "ownerId": "uid_de_juan",
  "createdAt": "timestamp"
}
```

### `events/{id}` — Planes de una sola vez
```json
{
  "title": "Cita en el café",
  "type": "date",
  "startDate": "2025-06-15",
  "endDate": "2025-06-15",
  "startTime": "17:00",
  "endTime": "19:00",
  "allDay": false,
  "description": "Café El Patio",
  "ownerEmail": "juanrubio2277@gmail.com",
  "createdBy": "uid_de_juan",
  "sharedWith": ["juanrubio2277@gmail.com", "greisisayoja@gmail.com"],
  "createdAt": "timestamp"
}
```

### `notifications/{id}`
```json
{
  "recipientId": "uid_de_greisi",
  "title": "Juan agregó un plan",
  "body": "\"Cita en el café\" el 2025-06-15 a las 17:00",
  "type": "new_event",
  "read": false,
  "createdAt": "timestamp"
}
```

---

## 🔒 Seguridad

Solo `juanrubio2277@gmail.com` y `greisisayoja@gmail.com` tienen acceso.
Las reglas de Firestore lo verifican del lado del servidor.

---

_Hecho con 💜 para Juan y Greisi_
