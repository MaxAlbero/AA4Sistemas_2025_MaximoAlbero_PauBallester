// Lógica server-authoritative usando las estructuras de NodeGrid del cliente C#:
// - GridSetup: { playerId, playerName, sizeX, sizeY }
// - GridUpdate: { playerId, playerName, updatedNodes: [{ type, x, y }] }

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
  constructor() {
    this.sizeX = 0;
    this.sizeY = 0;
    this.playerId = 0;
    this.playerName = "P1";
    this.grid = [];         // matriz [sizeX][sizeY] con JewelType
    this._interval = null;
    this.tickMs = 500;

    this.onSetup = null;    // function(GridSetup)
    this.onUpdate = null;   // function(GridUpdate)
    this.onEnd = null;      // function()
  }

  // Inicializa el grid a partir del GridSetup del cliente
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

    if (this.onSetup) this.onSetup({
      playerId: this.playerId,
      playerName: this.playerName,
      sizeX: this.sizeX,
      sizeY: this.sizeY
    });
  }

  // Lógica de Columns (simple): caída de gemas + limpieza de tríos verticales
  step() {
    const updatedNodes = [];

    const col = Math.floor(Math.random() * this.sizeX);
    for (let y = this.sizeY - 1; y >= 0; y--) {
      if (this.grid[col][y] === Jewel.None) {
        this.grid[col][y] = JEWELS[Math.floor(Math.random() * JEWELS.length)];
        break;
      }
    }

    const toClear = [];
    for (let x = 0; x < this.sizeX; x++) {
      for (let y = 0; y <= this.sizeY - 3; y++) {
        const a = this.grid[x][y], b = this.grid[x][y + 1], c = this.grid[x][y + 2];
        if (a !== Jewel.None && a === b && b === c) {
          toClear.push({ x, y }, { x, y: y + 1 }, { x, y: y + 2 });
        }
      }
    }
    toClear.forEach(({ x, y }) => this.grid[x][y] = Jewel.None);

    // Compactación de columnas
    for (let x = 0; x < this.sizeX; x++) {
      const stack = this.grid[x].filter(v => v !== Jewel.None);
      while (stack.length < this.sizeY) stack.unshift(Jewel.None);
      this.grid[x] = stack;
    }

    // Actualizaciones incrementales (col afectada + clears)
    for (let y = 0; y < this.sizeY; y++) {
      updatedNodes.push({ type: this.grid[col][y], x: col, y });
    }
    toClear.forEach(({ x, y }) => updatedNodes.push({ type: Jewel.None, x, y }));

    return {
      playerId: this.playerId,
      playerName: this.playerName,
      updatedNodes
    };
  }

  start() {
    if (this.sizeX <= 0 || this.sizeY <= 0) throw new Error("Call provideSetup first");
    const self = this;
    this._interval = setInterval(function () {
      const update = self.step();
      if (self.onUpdate) self.onUpdate(update);
    }, this.tickMs);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    if (this.onEnd) this.onEnd();
  }
}

module.exports = { NodeGridColumnsServer, Jewel };