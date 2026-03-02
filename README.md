# SerieB

Proyecto React + TypeScript + Vite preparado para desplegar en GitHub Pages.

## Requisitos

- Node.js 18+
- Repositorio en GitHub

## Primer despliegue

1. Instala dependencias:

```bash
npm install
```

2. Publica en GitHub Pages:

```bash
npm run deploy
```

Esto construye el proyecto y publica el contenido de `dist/` en la rama `gh-pages`.

## Activar GitHub Pages en el repositorio

En GitHub:

- Ve a **Settings** → **Pages**
- En **Source**, selecciona **Deploy from a branch**
- Elige la rama `gh-pages` y carpeta `/ (root)`

## Despliegues posteriores

Cada vez que quieras publicar cambios:

```bash
npm run deploy
```
