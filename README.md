# Chat-local

Chat en tiempo real para dispositivos en la misma red local, construido con **Node.js**, **Express** y **Socket.io**.

## Características

- Crear y eliminar salas de chat
- Mensajes en tiempo real entre todos los dispositivos de la red
- Identificación por nombre o dirección IP
- Persistencia: cada chat se guarda en un archivo `.txt` en la carpeta `chats/`
- Interfaz responsive para móvil y escritorio

## Instalación y uso

```bash
# Instalar dependencias
npm install

# Iniciar el servidor
npm start
```

Luego abre `http://<IP-de-tu-máquina>:3000` desde cualquier dispositivo en la misma red.  
Por ejemplo: `http://192.168.1.10:3000`

## Estructura

```
├── server.js          # Servidor Node.js (Express + Socket.io)
├── public/
│   ├── index.html     # Interfaz principal
│   ├── style.css      # Estilos
│   └── app.js         # Lógica del cliente
└── chats/             # Archivos .txt con el historial de cada chat
```

## Formato de persistencia

Cada chat se almacena en `chats/<uuid>.txt` (nombre interno generado automáticamente). El mapeo entre nombre del chat y UUID se guarda en `chats/_manifest.json`.

Formato de cada línea en el archivo de chat:

```
[2024-01-15T10:30:00.000Z] Juan: Hola a todos
[2024-01-15T10:30:05.000Z] 192.168.1.5: ¡Hola!
```