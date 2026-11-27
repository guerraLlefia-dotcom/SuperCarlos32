(() => {
  "use strict";

  const definitions = {
    coin: {
      src: "images/items/coin.png", columns: 5, rows: 1,
      animations: {
        spin: { row: 0, start: 0, frames: 5, frameDuration: 0.11, loop: true }
      }
    },
    star: {
      src: "images/items/goal.png", columns: 5, rows: 1,
      animations: {
        idle: { row: 0, start: 0, frames: 5, frameDuration: 0.14, loop: true }
      }
    },
    rock: {
      src: "images/items/rock.png", columns: 5, rows: 1,
      animations: {
        idle: { row: 0, start: 0, frames: 1, frameDuration: 1, loop: true },
        destroy: { row: 0, start: 1, frames: 4, frameDuration: 0.14, loop: false }
      }
    },
    monkey: {
      src: "images/enemies/monkey.png", columns: 6, rows: 3,
      animations: {
        walkFront: { row: 0, start: 0, frames: 3, frameDuration: 0.18, loop: true },
        walkSide: { row: 0, start: 3, frames: 3, frameDuration: 0.18, loop: true },
        walkBack: { row: 1, start: 0, frames: 3, frameDuration: 0.18, loop: true },
        defeatedFront: { row: 1, start: 3, frames: 3, frameDuration: 0.20, loop: false },
        defeatedSide: { row: 2, start: 0, frames: 3, frameDuration: 0.20, loop: false },
        defeatedBack: { row: 2, start: 3, frames: 3, frameDuration: 0.20, loop: false }
      }
    }
  };

  const loaded = {};

  function scanFrames(image, definition, frameWidth, frameHeight) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const frames = [];

    for (let row = 0; row < definition.rows; row++) {
      for (let col = 0; col < definition.columns; col++) {
        const left = Math.floor(col * frameWidth);
        const top = Math.floor(row * frameHeight);
        const right = Math.floor((col + 1) * frameWidth);
        const bottom = Math.floor((row + 1) * frameHeight);
        let minX = right, minY = bottom, maxX = left - 1, maxY = top - 1;

        for (let y = top; y < bottom; y++) {
          for (let x = left; x < right; x++) {
            if (pixels[(y * canvas.width + x) * 4 + 3] > 8) {
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
        }

        frames.push(maxX < minX
          ? { x: left, y: top, width: frameWidth, height: frameHeight }
          : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
      }
    }
    return frames;
  }

  function loadImage(name, definition) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const frameWidth = image.naturalWidth / definition.columns;
        const frameHeight = image.naturalHeight / definition.rows;
        if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight) ||
            frameWidth <= 0 || frameHeight <= 0) {
          reject(new Error("Spritesheet inválido: " + name));
          return;
        }
        loaded[name] = {
          image, definition, frameWidth, frameHeight,
          frames: scanFrames(image, definition, frameWidth, frameHeight)
        };
        resolve(loaded[name]);
      };
      image.onerror = () => reject(new Error("No se pudo cargar " + definition.src));
      image.src = definition.src;
    });
  }

  const ready = Promise.all(
    Object.entries(definitions).map(([name, definition]) => loadImage(name, definition))
  );

  class AnimatedSprite {
    constructor(name, animationName) {
      this.name = name;
      this.asset = loaded[name];
      if (!this.asset) throw new Error("El recurso aún no está cargado: " + name);
      this.animationName = null;
      this.frame = 0;
      this.elapsed = 0;
      this.finished = false;
      this.setAnimation(animationName, true);
    }

    setAnimation(animationName, restart = false) {
      const clip = this.asset.definition.animations[animationName];
      if (!clip) throw new Error("Animación desconocida: " + this.name + "." + animationName);
      if (this.animationName === animationName && !restart) return;

      this.animationName = animationName;
      this.clip = clip;
      this.frame = 0;
      this.elapsed = 0;
      this.finished = false;

      const bounds = [];
      for (let i = 0; i < clip.frames; i++) {
        const index = clip.row * this.asset.definition.columns + clip.start + i;
        bounds.push(this.asset.frames[index]);
      }
      this.clipWidth = Math.max(...bounds.map(frame => frame.width));
      this.clipHeight = Math.max(...bounds.map(frame => frame.height));
    }

    update(deltaTime) {
      if (this.finished) return;
      this.elapsed += Math.max(0, deltaTime);
      while (this.elapsed >= this.clip.frameDuration) {
        this.elapsed -= this.clip.frameDuration;
        if (this.frame + 1 < this.clip.frames) {
          this.frame++;
        } else if (this.clip.loop) {
          this.frame = 0;
        } else {
          this.frame = this.clip.frames - 1;
          this.finished = true;
          this.elapsed = 0;
          break;
        }
      }
    }

    draw(context, x, y, width, height, options = {}) {
      const column = this.clip.start + this.frame;
      const index = this.clip.row * this.asset.definition.columns + column;
      const frame = this.asset.frames[index];

      // Escala uniforme y línea inferior común para evitar aplastamiento
      // y saltos de posición entre fotogramas consecutivos.
      const scale = Math.min(width / this.clipWidth, height / this.clipHeight);
      const drawWidth = frame.width * scale;
      const drawHeight = frame.height * scale;
      const drawX = x + (width - this.clipWidth * scale) / 2 +
        (this.clipWidth - frame.width) * scale / 2;
      const drawY = y + height - drawHeight;

      context.save();
      context.imageSmoothingEnabled = false;
      if (options.flipX) {
        context.translate(x * 2 + width, 0);
        context.scale(-1, 1);
      }
      context.drawImage(
        this.asset.image,
        frame.x, frame.y, frame.width, frame.height,
        drawX, drawY, drawWidth, drawHeight
      );
      context.restore();
    }

    get isFinished() {
      return this.finished;
    }
  }

  window.GameSprites = {
    ready,
    create(name, animationName) {
      return new AnimatedSprite(name, animationName);
    },
    definitions
  };
})();
