(() => {
  "use strict";

  // El mapa y los sprites se dibujan en coordenadas originales de 1536 × 1024.
  const WORLD = { width: 1536, height: 1024 };
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const status = document.getElementById("status");
  const loading = document.getElementById("loading");

  const map = new Image();
  map.src = "images/stages/stage%201.png";

  const spriteSheet = new Image();
  spriteSheet.src = "images/player/player.png";

  // La hoja del protagonista está organizada en 9 columnas y 5 filas:
  // fila 0 = inactivo, fila 1 = correr, fila 2 = saltar.
  // En cada fila: 3 frames de frente, 3 de perfil y 3 de espaldas.
  const SHEET = { columns: 9, rows: 5, idleRow: 0, runRow: 1, jumpRow: 2 };

  const player = {
    x: 330,
    y: 690,
    width: 86,
    height: 112,
    radius: 17,
    direction: "front",
    moving: false,
    frame: 0,
    frameTimer: 0,
    jumpHeight: 0,
    verticalSpeed: 0,
    grounded: true,
    platformHeight: 0,
    speed: 245
  };

  const keys = new Set();
  const directions = {
    front: 0,
    side: 3,
    "side-left": 3,
    back: 6
  };

  // Superficies transitables: las dos islas y el puente.
  const walkableAreas = [
    [[91,150],[185,137],[472,143],[515,181],[644,190],[681,246],[681,729],[650,795],[594,824],[153,818],[94,775],[78,690],[78,250]],
    [[883,202],[923,166],[1110,137],[1378,151],[1448,205],[1462,715],[1430,775],[1376,817],[946,815],[891,773],[872,700]],
    [[665,421],[887,421],[891,539],[665,539]]
  ];

  // Agua de la laguna: no se puede caminar ni saltar por encima.
  const lake = [[1071,419],[1111,410],[1145,419],[1171,405],[1216,411],[1240,425],[1280,423],[1310,446],[1332,481],[1356,493],[1364,541],[1347,566],[1321,578],[1317,626],[1285,654],[1245,668],[1194,682],[1140,671],[1102,681],[1072,661],[1041,641],[1016,616],[984,606],[967,577],[973,532],[988,501],[1026,481],[1054,455]];

  // Zonas elevadas. La altura es visual y permite caminar sobre la superficie
  // de los tocones después de saltar hasta ellos.
  const platforms = [
    { x: 365, y: 231, rx: 105, ry: 49, height: 66 },
    { x: 260, y: 378, rx: 82, ry: 39, height: 54 },
    { x: 455, y: 478, rx: 78, ry: 35, height: 46 },
    { x: 258, y: 570, rx: 82, ry: 38, height: 48 }
  ];

  // Volúmenes sólidos de las piedras y de la cueva.
  const obstacles = [
    { polygon: [[237,244],[482,244],[507,292],[481,367],[444,386],[267,380],[226,340]], platform: 0, depth: 382 },
    { polygon: [[171,396],[348,396],[365,451],[347,486],[199,492],[164,459]], platform: 1, depth: 493 },
    { polygon: [[365,473],[548,473],[553,523],[525,565],[388,565],[360,530]], platform: 2, depth: 568 },
    { polygon: [[169,573],[350,573],[359,619],[336,652],[197,652],[166,621]], platform: 3, depth: 654 },
    { polygon: [[1095,184],[1328,184],[1348,247],[1328,343],[1289,365],[1135,365],[1093,328],[1084,249]], depth: 366 }
  ];

  // Máscaras de las caras delanteras. Se vuelven a dibujar por encima del
  // jugador cuando este se encuentra detrás del objeto, creando profundidad.
  const foregroundMasks = [
    { depth: 382, polygon: [[238,258],[482,258],[481,367],[444,386],[267,380],[226,340]] },
    { depth: 493, polygon: [[171,398],[348,398],[365,451],[347,486],[199,492],[164,459]] },
    { depth: 568, polygon: [[365,474],[548,474],[553,523],[525,565],[388,565],[360,530]] },
    { depth: 654, polygon: [[169,574],[350,574],[359,619],[336,652],[197,652],[166,621]] },
    { depth: 366, polygon: [[1095,244],[1328,244],[1348,328],[1328,355],[1289,365],[1135,365],[1093,328]] }
  ];

  let lastTime = 0;
  let mapReady = false;
  let spriteReady = false;

  function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      const crosses = ((a[1] > y) !== (b[1] > y)) &&
        (x < (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || 0.00001) + a[0]);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function inEllipse(x, y, p) {
    return ((x - p.x) ** 2) / (p.rx ** 2) + ((y - p.y) ** 2) / (p.ry ** 2) <= 1;
  }

  function platformAt(x, y) {
    return platforms.find(p => inEllipse(x, y, p)) || null;
  }

  function isWalkable(x, y) {
    return walkableAreas.some(poly => pointInPolygon(x, y, poly));
  }

  // La sombra representa la huella del jugador en el suelo. Todas las
  // colisiones se calculan desde este punto, nunca desde el sprite dibujado.
  const FOOTPRINT_RADIUS = 12;
  const FOOTPRINT_SAMPLES = [
    [0, 0], [FOOTPRINT_RADIUS, 0], [-FOOTPRINT_RADIUS, 0],
    [0, FOOTPRINT_RADIUS], [0, -FOOTPRINT_RADIUS],
    [8, 8], [-8, 8], [8, -8], [-8, -8]
  ];

  function footprintTouchesPolygon(x, y, polygon) {
    return FOOTPRINT_SAMPLES.some(([ox, oy]) => pointInPolygon(x + ox, y + oy, polygon));
  }

  function collidesWithSolid(x, y, jumpHeight = player.jumpHeight, platformHeight = player.platformHeight) {
    // El lago siempre es infranqueable: el salto no permite cruzarlo.
    if (footprintTouchesPolygon(x, y, lake)) return true;

    for (const obstacle of obstacles) {
      if (!footprintTouchesPolygon(x, y, obstacle.polygon)) continue;

      const platform = obstacle.platform === undefined ? null : platforms[obstacle.platform];
      if (!platform) return true;

      const shadowOnTop = inEllipse(x, y, platform);
      const alreadyOnTop = platformHeight >= platform.height - 3 && shadowOnTop;
      // Para subir, la sombra debe estar dentro de la superficie y el
      // personaje debe haber alcanzado físicamente la altura de esa piedra.
      const jumpingHighEnough = jumpHeight >= platform.height && shadowOnTop;
      if (!alreadyOnTop && !jumpingHighEnough) return true;
    }
    return false;
  }

  function canStandAt(x, y) {
    if (!isWalkable(x, y)) return false;
    return !collidesWithSolid(x, y);
  }

  function getFrameColumn() {
    const base = directions[player.direction];
    return base + (player.frame % 3);
  }

  function drawPlayer() {
    const groundY = player.y;
    const renderY = groundY - player.jumpHeight - player.platformHeight;
    const drawX = player.x - player.width / 2;
    const drawY = renderY - player.height;

    // Sombra: permanece pegada al suelo incluso durante el salto.
    ctx.save();
    ctx.globalAlpha = Math.max(0.18, 0.42 - player.jumpHeight / 330);
    ctx.fillStyle = "#102d42";
    ctx.beginPath();
    // Esta elipse es el punto de apoyo real del personaje en el mapa.
    ctx.ellipse(player.x, groundY, 23, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = Math.max(0.22, 0.55 - player.jumpHeight / 300);
    ctx.strokeStyle = "#d7f4ff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    if (spriteReady) {
      const cellW = spriteSheet.naturalWidth / SHEET.columns;
      const cellH = spriteSheet.naturalHeight / SHEET.rows;
      const row = player.jumpHeight > 4 ? SHEET.jumpRow : (player.moving ? SHEET.runRow : SHEET.idleRow);
      const sx = getFrameColumn() * cellW;
      const sy = row * cellH;

      ctx.save();
      if (player.direction === "side-left") {
        ctx.translate(player.x * 2, 0);
        ctx.scale(-1, 1);
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(spriteSheet, sx, sy, cellW, cellH, drawX, drawY, player.width, player.height);
      ctx.restore();
    } else {
      // Sustituto provisional mientras termina de cargar el spritesheet.
      ctx.fillStyle = "#e52e35";
      ctx.fillRect(player.x - 19, renderY - 76, 38, 42);
      ctx.fillStyle = "#f3c59b";
      ctx.fillRect(player.x - 22, renderY - 105, 44, 35);
      ctx.fillStyle = "#a51d28";
      ctx.fillRect(player.x - 24, renderY - 111, 48, 15);
      ctx.fillStyle = "#fff";
      ctx.fillRect(player.x - 14, renderY - 91, 7, 9);
      ctx.fillRect(player.x + 7, renderY - 91, 7, 9);
      ctx.fillStyle = "#6b432d";
      ctx.fillRect(player.x - 19, renderY - 35, 16, 27);
      ctx.fillRect(player.x + 3, renderY - 35, 16, 27);
    }
  }

  function drawForegroundMask(mask) {
    ctx.save();
    ctx.beginPath();
    mask.polygon.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(map, 0, 0, WORLD.width, WORLD.height);
    ctx.restore();
  }

  function update(dt) {
    let dx = 0, dy = 0;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) dx -= 1;
    if (keys.has("ArrowRight") || keys.has("KeyD")) dx += 1;
    if (keys.has("ArrowUp") || keys.has("KeyW")) dy -= 1;
    if (keys.has("ArrowDown") || keys.has("KeyS")) dy += 1;

    const length = Math.hypot(dx, dy);
    player.moving = length > 0;

    if (length) {
      dx /= length; dy /= length;
      if (Math.abs(dx) > Math.abs(dy)) player.direction = dx < 0 ? "side-left" : "side";
      else player.direction = dy < 0 ? "back" : "front";

      const stepX = dx * player.speed * dt;
      const stepY = dy * player.speed * dt;
      const nextX = player.x + stepX;
      const nextY = player.y + stepY;

      // Comprobación por ejes para deslizarse junto a los obstáculos.
      // La sombra se desplaza primero en X y después en Y. Así se puede
      // rozar una pared y deslizarse por ella sin que el cuerpo del sprite
      // provoque colisiones falsas.
      if (canStandAt(nextX, player.y)) player.x = nextX;
      if (canStandAt(player.x, nextY)) player.y = nextY;
    }

    // Física vertical: espacio para saltar y gravedad para aterrizar.
    const currentPlatform = platformAt(player.x, player.y);
    const targetHeight = currentPlatform ? currentPlatform.height : 0;

    if (player.jumpHeight > 0 || player.verticalSpeed > 0) {
      player.jumpHeight += player.verticalSpeed * dt;
      player.verticalSpeed -= 1050 * dt;

      if (player.jumpHeight <= 0) {
        player.jumpHeight = 0;
        player.verticalSpeed = 0;
        player.grounded = true;
      }
    }

    if (player.jumpHeight === 0) {
      if (currentPlatform && player.platformHeight < currentPlatform.height) {
        // Solo aterriza arriba si la trayectoria alcanzó la altura de la piedra.
        // La validación de altura ocurre durante el salto, usando la sombra.
        player.platformHeight = currentPlatform.height;
      } else if (!currentPlatform) {
        player.platformHeight = Math.max(0, player.platformHeight - 220 * dt);
      }
    }

    if (player.moving) {
      player.frameTimer += dt;
      if (player.frameTimer >= 0.13) {
        player.frame = (player.frame + 1) % 3;
        player.frameTimer = 0;
      }
    } else {
      player.frame = 0;
      player.frameTimer = 0;
    }
  }

  function render() {
    if (!mapReady) return;
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(map, 0, 0, WORLD.width, WORLD.height);

    // Máscaras de objetos que quedan por delante del personaje según su
    // profundidad. Si el jugador está delante, se dibujan antes que él.
    const behind = foregroundMasks.filter(mask => player.y < mask.depth);
    const inFront = foregroundMasks.filter(mask => player.y >= mask.depth);

    behind.forEach(drawForegroundMask);
    drawPlayer();
    inFront.forEach(drawForegroundMask);
  }

  function loop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000 || 0, 0.033);
    lastTime = timestamp;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  document.addEventListener("keydown", event => {
    const key = event.code;
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(key)) event.preventDefault();
    keys.add(key);

    if (key === "Space" && player.jumpHeight === 0 && player.verticalSpeed === 0) {
      player.verticalSpeed = 455;
      player.grounded = false;
      status.textContent = "¡Salto!";
    }
  });

  document.addEventListener("keyup", event => keys.delete(event.code));
  window.addEventListener("blur", () => keys.clear());

  map.onload = () => {
    mapReady = true;
    loading.classList.add("hidden");
    requestAnimationFrame(loop);
  };
  map.onerror = () => {
    loading.textContent = "No se pudo cargar images/stages/stage 1.png";
  };
  spriteSheet.onload = () => { spriteReady = true; };
  spriteSheet.onerror = () => {
    status.textContent = "No se pudo cargar el sprite del jugador; se muestra un personaje provisional.";
  };
})();