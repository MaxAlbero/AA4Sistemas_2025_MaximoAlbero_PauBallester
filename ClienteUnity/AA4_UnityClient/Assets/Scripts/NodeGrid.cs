using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class NodeGrid : MonoBehaviour
{
    [Serializable]
    public class Node
    {
        public enum JewelType
        {
            None = 0,
            Red = 1,
            Green = 2,
            Blue = 3,
            Yellow = 4,
            Orange = 5,
            Purple = 6,
            Shiny = 7
        }

        public int x, y;
        public JewelType type;
        public Node(JewelType type, int x, int y)
        {
            this.type = type;
            this.x = x;
            this.y = y;
        }
    }

    [Serializable]
    public class Grid
    {
        [Serializable]
        public class Column
        {
            public List<Node> nodes = new();
        }

        public List<Column> columns = new();

        [SerializeField]
        private int _playerId;
        public int PlayerId => _playerId;

        [SerializeField]
        private string _playerName;
        public string PlayerName => _playerName;

        public Grid(GridSetup gridSetup)
        {
            _playerId = gridSetup.playerId;
            _playerName = gridSetup.playerName;

            for (int x = 0; x < gridSetup.sizeX; x++)
            {
                columns.Add(new());
                for (int y = 0; y < gridSetup.sizeY; y++)
                {
                    columns[x].nodes.Add(new Node(Node.JewelType.None, x, y));
                }
            }
        }

        public Node GetNode(int x, int y)
        {
            return columns[x].nodes[y];
        }
    }

    [Serializable]
    public class GridUpdate
    {
        public int playerId;
        public string playerName;
        public List<Node> updatedNodes;
    }

    [Serializable]
    public class GridSetup
    {
        public int playerId;
        public string playerName;
        public int sizeX;
        public int sizeY;
    }

    private Grid _grid;

    public void SetupGrid(GridSetup gridSetup)
    {
        Debug.Log("CREADO DESDE NODEGRID.CS");

        // Limpia cualquier grid previa en la jerarquía
        var toDestroy = new List<GameObject>();
        foreach (Transform child in transform)
            toDestroy.Add(child.gameObject);
        foreach (var go in toDestroy)
            Destroy(go);


        // Crea el modelo de datos
        _grid = new Grid(gridSetup);

        // Parámetros visuales
        float cellSize = 1f;
        float padding = 0.05f;
        float visualSize = cellSize - padding;

        // Función local para mapear tipo->color
        Color ColorFor(Node.JewelType t)
        {
            switch (t)
            {
                case Node.JewelType.Red: return Color.red;
                case Node.JewelType.Green: return Color.green;
                case Node.JewelType.Blue: return Color.blue;
                case Node.JewelType.Yellow: return Color.yellow;
                case Node.JewelType.Orange: return new Color(1f, 0.5f, 0f);
                case Node.JewelType.Purple: return new Color(0.6f, 0.2f, 0.8f);
                case Node.JewelType.Shiny: return Color.white;
                default: return new Color(0.15f, 0.15f, 0.15f, 1f);
            }
        }

        // Crear visualización: un Quad por celda con nombre único Node_x_y
        // Se colocan como hijos directos de este componente para poder localizarlos con Transform.Find
        for (int x = 0; x < _grid.columns.Count; x++)
        {
            for (int y = 0; y < _grid.columns[x].nodes.Count; y++)
            {
                var nodeGo = GameObject.CreatePrimitive(PrimitiveType.Quad);
                nodeGo.name = $"Node_{x}_{y}";
                nodeGo.transform.SetParent(this.transform, false);
                nodeGo.transform.localScale = new Vector3(visualSize, visualSize, 1f);

                // Distribución en plano X-Y, con Y invertida para que (0,0) quede arriba-izquierda visualmente
                nodeGo.transform.localPosition = new Vector3(x * cellSize, -y * cellSize, 0f);

                var rend = nodeGo.GetComponent<Renderer>();
                rend.material.color = ColorFor(Node.JewelType.None);
            }
        }

        //// Centrar mínimamente la grid respecto al origen
        float height = (_grid.columns.Count > 0 ? _grid.columns[0].nodes.Count : 0) * cellSize;
        this.transform.localPosition = new Vector3(transform.localPosition.x, 0.5f * (height - cellSize), 0f);

        Debug.Log($"[NodeGrid] Grid setup {gridSetup.sizeX}x{gridSetup.sizeY} for {gridSetup.playerName} ({gridSetup.playerId})");
    }

    public void UpdateGrid(GridUpdate gridUpdate)
    {
        if (_grid == null)
        {
            Debug.LogWarning("[NodeGrid] UpdateGrid llamado antes de SetupGrid");
            return;
        }
        if (gridUpdate?.updatedNodes == null || gridUpdate.updatedNodes.Count == 0)
            return;

        // Función local para mapear tipo->color (duplicada para no añadir miembros)
        Color ColorFor(Node.JewelType t)
        {
            switch (t)
            {
                case Node.JewelType.Red: return Color.red;
                case Node.JewelType.Green: return Color.green;
                case Node.JewelType.Blue: return Color.blue;
                case Node.JewelType.Yellow: return Color.yellow;
                case Node.JewelType.Orange: return new Color(1f, 0.5f, 0f);
                case Node.JewelType.Purple: return new Color(0.6f, 0.2f, 0.8f);
                case Node.JewelType.Shiny: return Color.white;
                default: return new Color(0.15f, 0.15f, 0.15f, 1f);
            }
        }

        // Aplica al modelo y a la vista
        foreach (var n in gridUpdate.updatedNodes)
        {
            // Actualiza el modelo interno
            try
            {
                var node = _grid.GetNode(n.x, n.y);
                node.type = n.type;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[NodeGrid] Update fuera de rango ({n.x},{n.y}): {e.Message}");
                continue;
            }

            // Busca el visual por nombre y actualiza su color
            var t = transform.Find($"Node_{n.x}_{n.y}");
            if (t != null)
            {
                var rend = t.GetComponent<Renderer>();
                if (rend != null) rend.material.color = ColorFor(n.type);
            }
            else
            {
                Debug.LogWarning($"[NodeGrid] No se encontró visual para Node_{n.x}_{n.y}");
            }
        }
    }

    private void Start()
    {
        //The code shown below is an example of how to convert GridUpdate objects to JSON and vice versa.

        //Debug.Log("CREATED WITH START EXAMPLE IN NODE GRID.cs");

        //SetupGrid(new()
        //{
        //    playerId = 0,
        //    playerName = "P1",
        //    sizeX = 6,
        //    sizeY = 12
        //});

        //string json = JsonUtility.ToJson(_grid);

        //Debug.Log(json);

        //Grid g = JsonUtility.FromJson<Grid>(json);

        //GridUpdate update = new()
        //{
        //    playerId = 0,
        //    playerName = "P1",
        //    updatedNodes = new()
        //};

        //update.updatedNodes.Add(new Node(Node.JewelType.Red, 0, 1));
        //update.updatedNodes.Add(new Node(Node.JewelType.Green, 0, 2));
        //update.updatedNodes.Add(new Node(Node.JewelType.Blue, 0, 3));
        //update.updatedNodes.Add(new Node(Node.JewelType.None, 0, 4));

        //string json2 = JsonUtility.ToJson(update);

        //Debug.Log(json2);

        //GridUpdate update2 = JsonUtility.FromJson<GridUpdate>(json2);
    }
}