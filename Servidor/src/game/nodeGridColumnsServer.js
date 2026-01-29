// Server-authoritative Columns engine using NodeGrid structures.
// GridSetup: { playerId, playerName, sizeX, sizeY }
// GridUpdate: { playerId, playerName, updatedNodes: [{ type, x, y }] }

const Jewel = {
  None: 0,
  Red: 1,
  Green: 2,
  Blue: 3,
  Yellow: 4,
  Orange: 5,
  Purple: 6,
  Shiny: 7
};
const JEWELS = [Jewel.Red, Jewel.Green, Jewel.Blue, Jewel.Yellow, Jewel.Orange, Jewel.Purple];

class NodeGridColumnsServer {
  constructor(opts) {
    opts = opts || {};
    this.tickMsNormal = Number(opts.tickMs || 500);
    this.tickMsSoft = 100;

    this.sizeX = 0;
    this.sizeY = 0;
    this.playerId = 0;
    this.playerName = "P1";
    this.grid = []; // [x][y] -> Jewel

    // Estado de la columna en caída (3 gemas)
    this.falling = {
      x: 0,
      yTop: -3,        // y del segmento superior (puede ser negativo antes de entrar en la parrilla)
      jewels: [Jewel.Red, Jewel.Green, Jewel.Blue],
      softDrop: false,
      prevCells: []    // celdas visibles dibujadas previamente (para limpiar al mover)
    };

    this._interval = null;

    // Callbacks hacia el exterior
    this.onSetup = null;   // (GridSetup)
    this.onUpdate = null;  // (GridUpdate)
    this.onEnd = null;     // ()
  }

  // Inicializa el grid y emite setup + snapshot inicial
  provideSetup(gridSetup) {
    if (!gridSetup || !Number.isFinite(gridSetup.sizeX) || !Number.isFinite(gridSetup.sizeY)) {
      throw new Error("Invalid GridSetup");
    }
    this.sizeX = Number(gridSetup.sizeX);
    this.sizeY = Number(gridSetup.sizeY);
    this.playerId = Number(gridSetup.playerId || 0);
    this.playerName = String(gridSetup.playerName || "P1");

    // Inicializa matriz con None
    this.grid = [];
    for (let x = 0; x < this.sizeX; x++) {
      const col = [];
      for (let y = 0; y < this.sizeY; y++) col.push(Jewel.None);
      this.grid.push(col);
    }

    // Spawnear primera columna
    this._spawnNewColumn();

    // Emitir setup y snapshot completo (útil para espectadores tardíos)
    if (this.onSetup) {
      this.onSetup({
        playerId: this.playerId,
        playerName: this.playerName,
        sizeX: this.sizeX,
        sizeY: this.sizeY
      });
    }
    const full = this.getFullUpdate();
    if (this.onUpdate) this.onUpdate(full);
  }

  // Construye un GridUpdate con TODO el estado actual
  getFullUpdate() {
    const updatedNodes = [];
    for (let x = 0; x < this.sizeX; x++) {
      for (let y = 0; y < this.sizeY; y++) {
        updatedNodes.push({ type: this.grid[x][y], x, y });
      }
    }
    // Incluir columna en caída si es visible
    const fallCells = this._currentFallingCells();
    fallCells.forEach(c => {
      if (c.y >= 0 && c.y < this.sizeY) {
        updatedNodes.push({ type: c.type, x: c.x, y: c.y });
      }
    });
    return { playerId: this.playerId, playerName: this.playerName, updatedNodes };
  }

  start() {
    if (this.sizeX <= 0 || this.sizeY <= 0) throw new Error("Call provideSetup first");
    const tick = () => {
      const update = this.step();
      if (update && this.onUpdate) this.onUpdate(update);
    };
    this._interval = setInterval(tick, this._tickMs());
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    if (this.onEnd) this.onEnd();
  }

  // Aplica input del jugador
  applyInput(action) {
    // action: 'left' | 'right' | 'rotate' | 'softDropStart' | 'softDropEnd'
    switch (action) {
      case "left":
        this._tryShift(-1);
        break;
      case "right":
        this._tryShift(1);
        break;
      case "rotate":
        // Rotación simple: top->mid->bottom->top
        const j = this.falling.jewels;
        this.falling.jewels = [j[2], j[0], j[1]];
        this._refreshFallingVisual();
        break;
      case "softDropStart":
        this.falling.softDrop = true;
        this._retimeInterval();
        break;
      case "softDropEnd":
        this.falling.softDrop = false;
        this._retimeInterval();
        break;
    }
  }

  // Un paso de simulación
  step() {
    const updateNodes = [];

    // Limpiar visual previo de la columna
    this.falling.prevCells.forEach(c => {
      if (c.y >= 0 && c.y < this.sizeY) updateNodes.push({ type: Jewel.None, x: c.x, y: c.y });
    });

    // Intentar caer una fila
    if (this._canFallOne()) {
      this.falling.yTop += 1;
      const cells = this._currentFallingCells();
      this.falling.prevCells = cells;
      cells.forEach(c => {
        if (c.y >= 0 && c.y < this.sizeY) updateNodes.push({ type: c.type, x: c.x, y: c.y });
      });
      return { playerId: this.playerId, playerName: this.playerName, updatedNodes: updateNodes };
    }

    // No puede caer: bloquear en el grid
    const lockCells = this._currentFallingCells();
    lockCells.forEach(c => {
      if (c.y >= 0 && c.y < this.sizeY) {
        this.grid[c.x][c.y] = c.type;
        updateNodes.push({ type: c.type, x: c.x, y: c.y });
      }
    });

    // 1) Limpiar combinaciones (verticales y horizontales mínimas)
    let cleared = this._clearMatches();
    cleared.forEach(c => updateNodes.push({ type: Jewel.None, x: c.x, y: c.y }));

    // 2) Aplicar gravedad con movimientos explícitos (origen y destino)
    let moves = this._applyGravity();
    moves.forEach(m => {
      updateNodes.push({ type: Jewel.None, x: m.fromX, y: m.fromY });
      updateNodes.push({ type: this.grid[m.toX][m.toY], x: m.toX, y: m.toY });
    });

    // 3) Cascadas: repetir limpieza+gravedad hasta estabilizar
    while (true) {
      const moreClears = this._clearMatches();
      if (!moreClears.length) break;
      moreClears.forEach(c => updateNodes.push({ type: Jewel.None, x: c.x, y: c.y }));

      const moreMoves = this._applyGravity();
      moreMoves.forEach(m => {
        updateNodes.push({ type: Jewel.None, x: m.fromX, y: m.fromY });
        updateNodes.push({ type: this.grid[m.toX][m.toY], x: m.toX, y: m.toY });
      });
    }

    // Nueva columna en caída
    this._spawnNewColumn();
    this.falling.prevCells.forEach(c => {
      if (c.y >= 0 && c.y < this.sizeY) updateNodes.push({ type: c.type, x: c.x, y: c.y });
    });

    return { playerId: this.playerId, playerName: this.playerName, updatedNodes: updateNodes };
  }

  // ===== Helpers =====

  _tickMs() {
    return this.falling.softDrop ? this.tickMsSoft : this.tickMsNormal;
  }

  _retimeInterval() {
    if (!this._interval) return;
    clearInterval(this._interval);
    const tick = () => {
      const update = this.step();
      if (update && this.onUpdate) this.onUpdate(update);
    };
    this._interval = setInterval(tick, this._tickMs());
  }

  _spawnNewColumn() {
    this.falling.x = Math.floor(this.sizeX / 2);
    this.falling.yTop = -3;
    this.falling.jewels = [
      JEWELS[Math.floor(Math.random() * JEWELS.length)],
      JEWELS[Math.floor(Math.random() * JEWELS.length)],
      JEWELS[Math.floor(Math.random() * JEWELS.length)],
    ];
    this.falling.prevCells = this._currentFallingCells();
  }

  _currentFallingCells() {
    const x = this.falling.x;
    const yTop = this.falling.yTop;
    const [t, m, b] = this.falling.jewels;
    return [
      { x, y: yTop,     type: t },
      { x, y: yTop + 1, type: m },
      { x, y: yTop + 2, type: b },
    ];
  }

  _tryShift(dx) {
    const targetX = this.falling.x + dx;
    if (targetX < 0 || targetX >= this.sizeX) return;
    const yTop = this.falling.yTop;
    // Comprobar ocupación para partes visibles (y en 0..sizeY-1)
    for (let i = 0; i < 3; i++) {
      const y = yTop + i;
      if (y >= 0 && y < this.sizeY) {
        if (this.grid[targetX][y] !== Jewel.None) return; // bloqueado
      }
    }
    this.falling.x = targetX;
    this._refreshFallingVisual();
  }

  _refreshFallingVisual() {
    const updateNodes = [];
    this.falling.prevCells.forEach(c => {
      if (c.y >= 0 && c.y < this.sizeY) updateNodes.push({ type: Jewel.None, x: c.x, y: c.y });
    });
    const cells = this._currentFallingCells();
    this.falling.prevCells = cells;
    cells.forEach(c => {
      if (c.y >= 0 && c.y < this.sizeY) updateNodes.push({ type: c.type, x: c.x, y: c.y });
    });
    if (this.onUpdate) this.onUpdate({ playerId: this.playerId, playerName: this.playerName, updatedNodes: updateNodes });
  }

  _canFallOne() {
    const x = this.falling.x;
    const yTopNext = this.falling.yTop + 1;
    const yBottomNext = yTopNext + 2;

    if (yBottomNext < 0) return true;              // aún por encima, puede caer
    if (yBottomNext >= this.sizeY) return false;   // tocaría fondo

    // Bloqueo por ocupación
    if (this.grid[x][yBottomNext] !== Jewel.None) return false;
    const midY = yTopNext + 1;
    if (midY >= 0 && midY < this.sizeY && this.grid[x][midY] !== Jewel.None) return false;
    const topY = yTopNext;
    if (topY >= 0 && topY < this.sizeY && this.grid[x][topY] !== Jewel.None) return false;

    return true;
  }

  // Limpia secuencias de 3+ iguales en horizontal, vertical y diagonales
  _clearMatches() {
    const key = (x, y) => `${x},${y}`;
    const toClearSet = new Set();

    const inBounds = (x, y) => (x >= 0 && x < this.sizeX && y >= 0 && y < this.sizeY);

    const dirs = [
      { dx: 1, dy: 0 },   // horizontal →
      { dx: 0, dy: 1 },   // vertical ↓
      { dx: 1, dy: 1 },   // diagonal ↓→
      { dx: -1, dy: 1 },  // diagonal ↓←
    ];

    for (let y = 0; y < this.sizeY; y++) {
      for (let x = 0; x < this.sizeX; x++) {
        const val = this.grid[x][y];
        if (val === Jewel.None) continue;

        for (const { dx, dy } of dirs) {
          // Contar longitud de la secuencia desde (x,y) en dirección (dx,dy)
          let len = 1;
          let nx = x + dx, ny = y + dy;
          while (inBounds(nx, ny) && this.grid[nx][ny] === val) {
            len++;
            nx += dx; ny += dy;
          }

          if (len >= 3) {
            // Añadir todas las posiciones de la secuencia al conjunto
            nx = x; ny = y;
            for (let i = 0; i < len; i++) {
              toClearSet.add(key(nx, ny));
              nx += dx; ny += dy;
            }
          }
        }
      }
    }

    // Aplicar limpieza en la matriz y devolver lista de posiciones
    const toClear = [];
    toClearSet.forEach(k => {
      const [sx, sy] = k.split(",").map(Number);
      this.grid[sx][sy] = Jewel.None;
      toClear.push({ x: sx, y: sy });
    });

    return toClear;
  }

  // Gravedad con movimientos explícitos (origen y destino)
  _applyGravity() {
    const moves = [];
    for (let x = 0; x < this.sizeX; x++) {
      let writeY = this.sizeY - 1;
      for (let y = this.sizeY - 1; y >= 0; y--) {
        const val = this.grid[x][y];
        if (val !== Jewel.None) {
          if (y !== writeY) {
            this.grid[x][writeY] = val;
            this.grid[x][y] = Jewel.None;
            moves.push({ fromX: x, fromY: y, toX: x, toY: writeY });
          }
          writeY--;
        }
      }
    }
    return moves;
  }
}

module.exports = { NodeGridColumnsServer, Jewel };