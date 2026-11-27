(() => {
  "use strict";

  // Animaciones de los recursos del primer nivel.
  // Los spritesheets se dividen en celdas regulares; se dibuja cada celda
  // completa para conservar los márgenes y efectos de cada fotograma.

  const definitions = {
    coin: {
      src: "images/items/coin.png",
      columns: 5,
      rows: 1,
      animations: {
        spin: { row: 0, start: 0, frames: 5, frameDuration: 0.11, loop: true }
      }
    },
    star: {
      src: "images/items/goal.png",
      columns: 5,
      rows: 1,
      animations: {
        idle: { row: 0, start: 0, frames: 5, frameDuration: 0.14, loop: true }
      }
    },
    monkey: {
      src: "images/enemies/monkey.png",
      columns: 6,
      rows: 3,
      animations: {
        walkFront: { row: 0, start: 0, frames: 3, frameDuration: 0.15, loop: true },
        walkSide: { row: 0, start: 3, frames: 3, frameDuration: 0.15, loop: true },
        walkBack: { row: 1, start: 0, frames: 3, frameDuration: 0.15, loop: true },
        defeatedFront: { row: 1, start: 3, frames: 3, frameDuration: 0.17, loop: false },
        defeatedSide: { row: 2, start: 0, frames: 3, frameDuration: 0.17, loop: false },
        defeatedBack: { row: 2, start: 3, frames: 3, frameDuration: 0.17, loop: false }
      }
    }
  };

  const loaded = {};

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

        loaded[name] = { image, definition, frameWidth, frameHeight };
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
      const asset = loaded[name];
      if (!asset) throw new Error("El recurso aún no está cargado: " + name);

      this.name = name;
      this.asset = asset;
      this.animationName = animationName;
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
      const { image, frameWidth, frameHeight } = this.asset;
      const column = this.clip.start + this.frame;
      const row = this.clip.row;
      const sourceX = column * frameWidth;
      const sourceY = row * frameHeight;

      context.save();
      context.imageSmoothingEnabled = false;
      if (options.flipX) {
        context.translate(x * 2 + width, 0);
        context.scale(-1, 1);
      }
      context.drawImage(
        image,
        sourceX, sourceY, frameWidth, frameHeight,
        x, y, width, height
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
