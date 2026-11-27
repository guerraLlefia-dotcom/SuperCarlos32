(() => {
  "use strict";

  // El mundo y el canvas usan las dimensiones originales del escenario.
  // No existe salto, altura, gravedad ni plataformas elevadas.
  const WORLD = { width: 1774, height: 887 };
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const status = document.getElementById("status");
  const loading = document.getElementById("loading");

  const map = new Image();
  map.src = "images/stages/stage%201.png";

  const spriteSheet = new Image();
  spriteSheet.src = "images/player/player.png";

  // Spritesheet: 9 columnas (3 frames por orientación) × 5 filas.
  // Orientaciones: frontal 0-2, lateral 3-5, espalda 6-8.
  const SHEET = {
    columns: 9,
    rows: 5,
    idleRow: 0,
    runRow: 1,
    attackRow: 2,
    damageRow: 3,
    celebrateRow: 4
  };

  const player = {
    x: 420,
    y: 420, // Punto de apoyo: centro de los pies sobre el suelo.
    width: 112,
    height: 132,
    direction: "front",
    facingLeft: false,
    moving: false,
    frame: 0,
    frameTimer: 0,
    speed: 235,
    attacking: false,
    attackTimer: 0,
    attackDuration: 0.48,
    attackCooldown: 0
  };

  const keys = new Set();
  const directionColumns = { front: 0, side: 3, back: 6 };

  // Límites interiores de las zonas de hierba. El puente conecta ambas
  // islas; el agua y los bordes rocosos quedan fuera de estas áreas.
  const walkableAreas = [
    [
      [48, 290], [76, 224], [128, 179], [244, 161], [294, 91],
      [350, 43], [426, 43], [487, 105], [579, 137], [656, 174],
      [713, 228], [774, 290], [796, 357], [774, 424], [721, 492],
      [735, 584], [784, 665], [752, 701], [692, 733], [610, 749],
      [527, 733], [442, 748], [355, 728], [267, 741], [185, 710],
      [126, 665], [78, 599], [43, 505]
    ],
    [
      [978, 330], [1008, 275], [1056, 213], [1125, 185], [1205, 178],
      [1291, 137], [1368, 65], [1457, 52], [1528, 83], [1595, 139],
      [1668, 194], [1708, 267], [1725, 365], [1705, 464], [1677, 570],
      [1701, 654], [1652, 704], [1578, 739], [1491, 747], [1405, 728],
      [1317, 744], [1226, 730], [1140, 748], [1060, 715],
      [1017, 667], [1035, 603], [984, 526], [970, 438]
    ],
    // Superficie transitable del puente.
    [[770, 330], [1000, 330], [1000, 424], [770, 424]]
  ];

  const FOOTPRINT_RADIUS = 10;
  const FOOTPRINT_SAMPLES = [
    [0, 0], [FOOTPRINT_RADIUS, 0], [-FOOTPRINT_RADIUS, 0],
    [0, FOOTPRINT_RADIUS], [0, -FOOTPRINT_RADIUS],
    [7, 7], [-7, 7], [7, -7], [-7, -7]
  ];

  // La nueva hoja está organizada en celdas fijas de 170 × 205 px.
  // Nunca recortamos el dibujo: cada frame usa su celda completa.
  let spriteFrames = [];
  let spriteScale = 1;
  let cellWidth = 0;
  let cellHeight = 0;

  function findCellFootAnchor(imageData, imageWidth, left, top, width, height) {
    // Algunos frames contienen píxeles sueltos debajo de los zapatos.
    // Buscamos el componente conectado más grande para identificar el cuerpo
    // del personaje e ignorar esos restos y efectos aislados.
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let bestArea = 0;
    let bestBottom = -1;
    let bestFootLeft = width;
    let bestFootRight = -1;

    for (let startY = 0; startY < height; startY++) {
      for (let startX = 0; startX < width; startX++) {
        const startIndex = startY * width + startX;
        if (visited[startIndex]) continue;

        const alpha = imageData[
          ((top + startY) * imageWidth + left + startX) * 4 + 3
        ];
        if (alpha <= 8) {
          visited[startIndex] = 1;
          continue;
        }

        let head = 0;
        let tail = 0;
        let area = 0;
        let componentBottom = -1;
        let footLeft = width;
        let footRight = -1;

        queue[tail++] = startIndex;
        visited[startIndex] = 1;

        while (head < tail) {
          const index = queue[head++];
          const x = index % width;
          const y = Math.floor(index / width);
          area++;

          if (y > componentBottom) {
            componentBottom = y;
            footLeft = x;
            footRight = x;
          } else if (y >= componentBottom - 2) {
            footLeft = Math.min(footLeft, x);
            footRight = Math.max(footRight, x);
          }

          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              if (ox === 0 && oy === 0) continue;
              const nx = x + ox;
              const ny = y + oy;
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

              const nextIndex = ny * width + nx;
              if (visited[nextIndex]) continue;
              visited[nextIndex] = 1;

              const nextAlpha = imageData[
                ((top + ny) * imageWidth + left + nx) * 4 + 3
              ];
              if (nextAlpha > 8) queue[tail++] = nextIndex;
            }
          }
        }

        if (area > bestArea) {
          bestArea = area;
          bestBottom = componentBottom;
          bestFootLeft = footLeft;
          bestFootRight = footRight;
        }
      }
    }

    if (bestBottom < 0) return { x: width / 2, y: height - 1 };

    return {
      x: (bestFootLeft + bestFootRight) / 2,
      y: bestBottom
    };
  }
  function prepareSpriteFrames() {
    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = spriteSheet.naturalWidth;
    frameCanvas.height = spriteSheet.naturalHeight;
    const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
    frameCtx.drawImage(spriteSheet, 0, 0);

    cellWidth = spriteSheet.naturalWidth / SHEET.columns;
    cellHeight = spriteSheet.naturalHeight / SHEET.rows;

    if (!Number.isInteger(cellWidth) || !Number.isInteger(cellHeight)) {
      throw new Error("El spritesheet debe dividirse exactamente en 9 columnas y 5 filas.");
    }

    const pixels = frameCtx.getImageData(
      0, 0, frameCanvas.width, frameCanvas.height
    ).data;

    spriteFrames = [];

    for (let row = 0; row < SHEET.rows; row++) {
      for (let col = 0; col < SHEET.columns; col++) {
        const left = col * cellWidth;
        const top = row * cellHeight;
        const anchor = findCellFootAnchor(
          pixels, frameCanvas.width, left, top, cellWidth, cellHeight
        );

        spriteFrames.push({
          x: left,
          y: top,
          width: cellWidth,
          height: cellHeight,
          anchorX: anchor.x,
          anchorY: anchor.y
        });
      }
    }

    // En la animación de caminar, algunas poses levantan un pie y la
    // caja del personaje queda más alta dentro de su celda. Alineamos los
    // tres fotogramas de cada orientación con la misma línea de suelo.
    // Esto evita que el sprite suba y baje al avanzar la animación.
    const walkRowStart = SHEET.runRow * SHEET.columns;
    for (const firstColumn of [0, 3]) {
      const walkFrames = [0, 1, 2].map(offset =>
        spriteFrames[walkRowStart + firstColumn + offset]
      );
      const sharedGroundY = Math.max(...walkFrames.map(frame => frame.anchorY));
      walkFrames.forEach(frame => {
        frame.anchorY = sharedGroundY;
      });

      // Los sprites laterales ya están centrados visualmente dentro de
      // sus celdas. No debemos recalcular X desde la anchura de los pies:
      // su separación cambia entre poses y provoca un salto lateral aparente.
      if (firstColumn === 3) {
        walkFrames.forEach(frame => {
          frame.anchorX = cellWidth / 2;
        });
      }
    }

    // Una escala única para todas las celdas, sin ajustes por fotograma.
    spriteScale = Math.min(
      player.width / cellWidth,
      player.height / cellHeight
    );
  }

  let lastTime = 0;
  let mapReady = false;
  let spriteReady = false;

  function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      const crosses = ((a[1] > y) !== (b[1] > y)) &&
        (x < (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || 0.00001) + a[0]);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function canStandAt(x, y) {
    // Se comprueba toda la huella para impedir que los pies queden sobre
    // el agua o fuera de la isla, no solo el punto central.
    return FOOTPRINT_SAMPLES.every(([ox, oy]) =>
      walkableAreas.some(area => pointInPolygon(x + ox, y + oy, area))
    );
  }

  function getFrameColumn() {
    return directionColumns[player.direction] + (player.frame % 3);
  }

  function drawPlayer() {
    if (!spriteReady) return;

    const row = player.attacking ? SHEET.attackRow :
      (player.moving ? SHEET.runRow : SHEET.idleRow);
    const column = getFrameColumn();
    const frame = spriteFrames[row * SHEET.columns + column];
    if (!frame) return;

    // Se dibuja la celda COMPLETA (170 × 205), nunca un recorte variable.
    // El apoyo inferior detectado dentro de la celda se alinea con player.x/y.
    const drawWidth = cellWidth * spriteScale;
    const drawHeight = cellHeight * spriteScale;
    const drawX = player.x - frame.anchorX * spriteScale;
    const drawY = player.y - frame.anchorY * spriteScale;

    ctx.save();
    ctx.fillStyle = "rgba(12, 39, 54, 0.32)";
    ctx.beginPath();
    ctx.ellipse(player.x, player.y - 3, 25, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (player.direction === "side" && player.facingLeft) {
      ctx.translate(player.x * 2, 0);
      ctx.scale(-1, 1);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      spriteSheet,
      frame.x, frame.y, frame.width, frame.height,
      drawX, drawY, drawWidth, drawHeight
    );
    ctx.restore();
  }

  function startAttack() {
    if (player.attacking || player.attackCooldown > 0) return;

    player.attacking = true;
    player.moving = false;
    player.attackTimer = 0;
    player.frame = 0;
    player.frameTimer = 0;
    player.attackCooldown = player.attackDuration;
    status.textContent = "¡Ataque con martillo!";
  }

  function update(dt) {
    player.attackCooldown = Math.max(0, player.attackCooldown - dt);

    if (player.attacking) {
      player.attackTimer += dt;
      const progress = player.attackTimer / player.attackDuration;
      player.frame = Math.min(2, Math.floor(progress * 3));

      if (player.attackTimer >= player.attackDuration) {
        player.attacking = false;
        player.attackTimer = 0;
        player.frame = 0;
        status.textContent = "¡Sigue explorando!";
      }
    }

    let dx = 0;
    let dy = 0;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) dx -= 1;
    if (keys.has("ArrowRight") || keys.has("KeyD")) dx += 1;
    if (keys.has("ArrowUp") || keys.has("KeyW")) dy -= 1;
    if (keys.has("ArrowDown") || keys.has("KeyS")) dy += 1;

    const length = Math.hypot(dx, dy);
    player.moving = length > 0 && !player.attacking;

    if (length > 0) {
      dx /= length;
      dy /= length;

      if (Math.abs(dx) > Math.abs(dy)) {
        player.direction = "side";
        player.facingLeft = dx < 0;
      } else {
        player.direction = dy < 0 ? "back" : "front";
      }

      if (!player.attacking) {
        const nextX = player.x + dx * player.speed * dt;
        const nextY = player.y + dy * player.speed * dt;

        // Colisión por ejes: permite deslizarse junto a los bordes
        // y cruzar el puente sin atravesar el agua.
        if (canStandAt(nextX, player.y)) player.x = nextX;
        if (canStandAt(player.x, nextY)) player.y = nextY;
      }
    }

    if (!player.attacking && player.moving) {
      player.frameTimer += dt;
      if (player.frameTimer >= 0.13) {
        player.frame = (player.frame + 1) % 3;
        player.frameTimer -= 0.13;
      }
    } else if (!player.attacking) {
      player.frame = 0;
      player.frameTimer = 0;
    }
  }

  function render() {
    if (!mapReady) return;
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(map, 0, 0, WORLD.width, WORLD.height);
    drawPlayer();
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
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(key)) {
      event.preventDefault();
    }

    if (!keys.has(key) && (key === "Space" || key === "KeyX")) {
      startAttack();
    }
    keys.add(key);
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

  spriteSheet.onload = () => { prepareSpriteFrames(); spriteReady = true; };
  spriteSheet.onerror = () => {
    status.textContent = "No se pudo cargar el sprite del jugador.";
  };
})();