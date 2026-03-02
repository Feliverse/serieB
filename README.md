# SerieB Validator / Validador SerieB

Aplicación web para detectar el número de serie de billetes bolivianos mediante cámara o imagen de galería, identificar Serie B y validar si el número se encuentra dentro de rangos publicados.

Web app to detect Bolivian banknote serial numbers using camera or gallery images, identify Serie B, and validate whether the serial falls within published ranges.

---

## 🇪🇸 Español

### Descripción

Esta aplicación utiliza OCR para:

1. Leer el número de serie de un billete.
2. Detectar si pertenece a **Serie B**.
3. Verificar si el serial está dentro de rangos configurados para **Bs10, Bs20 y Bs50**.

### Requisitos

- Node.js 18+
- npm
- Repositorio en GitHub (para despliegue con Pages)

### Instalación

```bash
npm install
```

### Ejecutar en desarrollo

```bash
npm run dev
```

### Compilar

```bash
npm run build
```

### Despliegue en GitHub Pages

```bash
npm run deploy
```

Este comando compila el proyecto y publica `dist/` en la rama `gh-pages`.

### Configuración de Pages en GitHub

En GitHub:

- Ir a **Settings** → **Pages**
- En **Source**, seleccionar **Deploy from a branch**
- Elegir rama `gh-pages` y carpeta `/ (root)`

---

### Mini guía de estilo UI/UX

Para mantener consistencia visual en futuras mejoras:

1. **Prioridad de pantalla**: la cámara y los controles principales siempre arriba; información secundaria en acordeón o footer.
2. **Jerarquía de acciones**: un control primario destacado (monitoreo) y controles secundarios compactos (cámara/galería).
3. **Mensajes de estado**: cortos, directos y orientados a acción; evitar textos largos dentro del área de captura.
4. **Chips/HUD**: mostrar solo estado crítico en overlay (Serie, Corte, Legalidad, Cámara); detalle técnico fuera del overlay.
5. **Consistencia de botones**: mantener formas, radios, sombras y transiciones unificadas; usar íconos consistentes.
6. **Accesibilidad**: todo botón debe tener `aria-label`/`title`; mantener contraste alto en chips y mensajes de error.
7. **Responsive**: en móvil, priorizar controles y lectura rápida; evitar bloques anchos o múltiples filas innecesarias.

---

### Términos y Condiciones

Al usar esta aplicación, aceptas los siguientes términos:

1. **Uso informativo**: El resultado es una ayuda automatizada y no sustituye verificación oficial por autoridad competente.
2. **Sin garantía absoluta**: El OCR puede cometer errores por iluminación, enfoque, calidad de imagen, desgaste del billete o ángulo de captura.
3. **Responsabilidad del usuario**: La decisión final sobre aceptación/rechazo del billete es del usuario.
4. **Disponibilidad**: La app se ofrece “tal cual”, sin garantía de disponibilidad continua o ausencia total de errores.
5. **Privacidad**: El procesamiento se realiza en el navegador. No se garantiza almacenamiento remoto; cada despliegue puede variar según configuración de hosting o cambios futuros.
6. **Limitación de responsabilidad**: Los autores y colaboradores no se responsabilizan por pérdidas, daños o decisiones comerciales derivadas del uso de la aplicación.
7. **Cambios**: Estos términos pueden actualizarse en cualquier momento mediante cambios en este repositorio.

---

## 🇬🇧 English

### Description

This application uses OCR to:

1. Read a banknote serial number.
2. Detect whether it belongs to **Serie B**.
3. Validate whether the serial is within configured ranges for **Bs10, Bs20, and Bs50**.

### Requirements

- Node.js 18+
- npm
- GitHub repository (for Pages deployment)

### Installation

```bash
npm install
```

### Run in development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Deploy to GitHub Pages

```bash
npm run deploy
```

This command builds the project and publishes `dist/` to the `gh-pages` branch.

### GitHub Pages setup

In GitHub:

- Go to **Settings** → **Pages**
- In **Source**, choose **Deploy from a branch**
- Select branch `gh-pages` and folder `/ (root)`

---

### Mini UI/UX style guide

To keep visual consistency in future iterations:

1. **Screen priority**: keep camera and primary controls at the top; move secondary info to accordion/footer.
2. **Action hierarchy**: one prominent primary control (monitoring) plus compact secondary controls (camera/gallery).
3. **Status messaging**: short, actionable feedback; avoid long text inside the capture area.
4. **HUD/chips**: show only critical status in overlay (Serie, Denomination, Legality, Camera); keep technical detail outside overlay.
5. **Button consistency**: keep shared shape/radius/shadow/transition rules; use a consistent icon set.
6. **Accessibility**: all icon buttons need `aria-label`/`title`; preserve high contrast for chips and error messages.
7. **Responsive behavior**: prioritize quick readability and controls on mobile; avoid wide multi-row control clutter.

---

### Terms and Conditions

By using this application, you agree to the following terms:

1. **Informational use only**: Results are automated guidance and do not replace official verification by competent authorities.
2. **No absolute accuracy**: OCR may fail due to lighting, focus, image quality, note wear, or capture angle.
3. **User responsibility**: Final acceptance/rejection decisions remain the user’s responsibility.
4. **Availability**: The app is provided “as is,” without guarantees of continuous uptime or complete absence of errors.
5. **Privacy**: Processing happens in the browser. Remote storage is not guaranteed and may vary depending on hosting setup or future changes.
6. **Limitation of liability**: Authors and contributors are not liable for losses, damages, or business decisions derived from app usage.
7. **Changes**: These terms may be updated at any time through repository changes.
