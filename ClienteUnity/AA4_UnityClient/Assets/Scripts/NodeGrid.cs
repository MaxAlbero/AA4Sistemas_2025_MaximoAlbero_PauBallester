using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro; // Si usas TextMeshPro, si no, usa UnityEngine.UI para Text

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

    // === CONFIGURACIÓN PARA MÚLTIPLES GRIDS ===
    [Header("ScrollView Settings")]
    [SerializeField] private Transform scrollViewContent; // El "Content" del ScrollView
    [SerializeField] private GameObject gridPanelPrefab; // Prefab que contiene todo el panel de un jugador

    [Header("Node Settings")]
    [SerializeField] private GameObject nodePrefab; // Prefab para cada celda individual

    // Diccionario para gestionar múltiples grids (una por jugador)
    private Dictionary<int, PlayerGridData> playerGrids = new Dictionary<int, PlayerGridData>();

    // Clase helper para almacenar datos de cada jugador
    private class PlayerGridData
    {
        public Grid grid;
        public GameObject panelObject;
        public Transform gridContainer;
        public Dictionary<Vector2Int, GameObject> visualNodes;
        public TextMeshProUGUI playerNameText; // O usa "Text" si no usas TMP

        public PlayerGridData()
        {
            visualNodes = new Dictionary<Vector2Int, GameObject>();
        }
    }

    public void SetupGrid(GridSetup gridSetup)
    {
        // Si ya existe una grid para este jugador, la eliminamos primero
        if (playerGrids.ContainsKey(gridSetup.playerId))
        {
            RemovePlayerGrid(gridSetup.playerId);
        }

        // Crear el modelo de datos
        Grid newGrid = new Grid(gridSetup);

        // Crear el panel visual para este jugador
        GameObject panelObj = Instantiate(gridPanelPrefab, scrollViewContent);
        panelObj.name = $"GridPanel_Player_{gridSetup.playerId}_{gridSetup.playerName}";

        // Buscar los componentes dentro del prefab
        Transform gridContainer = panelObj.transform.Find("GridContainer");
        TextMeshProUGUI nameText = panelObj.GetComponentInChildren<TextMeshProUGUI>();
        // Si usas Text normal: Text nameText = panelObj.GetComponentInChildren<Text>();

        if (nameText != null)
        {
            nameText.text = $"{gridSetup.playerName} (ID: {gridSetup.playerId})";
        }

        // Crear estructura de datos para este jugador
        PlayerGridData playerData = new PlayerGridData
        {
            grid = newGrid,
            panelObject = panelObj,
            gridContainer = gridContainer,
            playerNameText = nameText
        };

        // Configurar GridLayoutGroup
        if (gridContainer != null)
        {
            GridLayoutGroup gridLayout = gridContainer.GetComponent<GridLayoutGroup>();
            if (gridLayout != null)
            {
                gridLayout.constraint = GridLayoutGroup.Constraint.FixedColumnCount;
                gridLayout.constraintCount = gridSetup.sizeX;
            }

            // Crear nodos visuales
            CreateVisualGrid(playerData, gridSetup.sizeX, gridSetup.sizeY);
        }

        // Guardar en el diccionario
        playerGrids[gridSetup.playerId] = playerData;

        Debug.Log($"Grid creada para {gridSetup.playerName} (ID: {gridSetup.playerId}): {gridSetup.sizeX}x{gridSetup.sizeY}");
    }

    public void UpdateGrid(GridUpdate gridUpdate)
    {
        if (!playerGrids.ContainsKey(gridUpdate.playerId))
        {
            Debug.LogError($"No existe grid para el jugador ID: {gridUpdate.playerId}. Llama a SetupGrid primero.");
            return;
        }

        PlayerGridData playerData = playerGrids[gridUpdate.playerId];

        // Actualizar los nodos en el modelo de datos y la visualización
        foreach (Node node in gridUpdate.updatedNodes)
        {
            if (node.x >= 0 && node.x < playerData.grid.columns.Count &&
                node.y >= 0 && node.y < playerData.grid.columns[node.x].nodes.Count)
            {
                playerData.grid.GetNode(node.x, node.y).type = node.type;
                UpdateVisualNode(playerData, node.x, node.y, node.type);
            }
        }

        Debug.Log($"Grid actualizada para jugador ID {gridUpdate.playerId}: {gridUpdate.updatedNodes.Count} nodos cambiados");
    }

    // Método adicional para eliminar la grid de un jugador (cuando salga de la sala)
    public void RemovePlayerGrid(int playerId)
    {
        if (playerGrids.ContainsKey(playerId))
        {
            Destroy(playerGrids[playerId].panelObject);
            playerGrids.Remove(playerId);
            Debug.Log($"Grid del jugador ID {playerId} eliminada");
        }
    }

    // Método para limpiar todas las grids (cuando salgas de una sala)
    public void ClearAllGrids()
    {
        foreach (var kvp in playerGrids)
        {
            if (kvp.Value.panelObject != null)
                Destroy(kvp.Value.panelObject);
        }
        playerGrids.Clear();
        Debug.Log("Todas las grids eliminadas");
    }

    private void CreateVisualGrid(PlayerGridData playerData, int sizeX, int sizeY)
    {
        if (playerData.gridContainer == null || nodePrefab == null)
        {
            Debug.LogWarning("GridContainer o NodePrefab no asignado");
            return;
        }

        // Crear nodos visuales (invertido en Y para que 0,0 esté abajo)
        for (int y = sizeY - 1; y >= 0; y--)
        {
            for (int x = 0; x < sizeX; x++)
            {
                GameObject nodeObj = Instantiate(nodePrefab, playerData.gridContainer);
                nodeObj.name = $"Node_{x}_{y}";

                Vector2Int pos = new Vector2Int(x, y);
                playerData.visualNodes[pos] = nodeObj;

                // Inicializar como vacío
                UpdateVisualNode(playerData, x, y, Node.JewelType.None);
            }
        }
    }

    private void UpdateVisualNode(PlayerGridData playerData, int x, int y, Node.JewelType type)
    {
        Vector2Int pos = new Vector2Int(x, y);

        if (!playerData.visualNodes.ContainsKey(pos))
        {
            Debug.LogWarning($"Nodo visual no encontrado en posición ({x}, {y})");
            return;
        }

        GameObject nodeObj = playerData.visualNodes[pos];

        // Actualizar el color según el tipo de joya
        Image nodeImage = nodeObj.GetComponent<Image>();
        if (nodeImage != null)
        {
            nodeImage.color = GetColorForJewelType(type);
        }
    }

    private Color GetColorForJewelType(Node.JewelType type)
    {
        switch (type)
        {
            case Node.JewelType.None:
                return new Color(0.2f, 0.2f, 0.2f, 0.5f);
            case Node.JewelType.Red:
                return Color.red;
            case Node.JewelType.Green:
                return Color.green;
            case Node.JewelType.Blue:
                return Color.blue;
            case Node.JewelType.Yellow:
                return Color.yellow;
            case Node.JewelType.Orange:
                return new Color(1f, 0.5f, 0f);
            case Node.JewelType.Purple:
                return new Color(0.5f, 0f, 1f);
            case Node.JewelType.Shiny:
                return Color.white;
            default:
                return Color.gray;
        }
    }



    //private void Start()
    //{
    //    The code shown below is an example of how to convert GridUpdate objects to JSON and vice versa.

    //    SetupGrid(new()
    //    {
    //        playerId = 0,
    //        playerName = "P1",
    //        sizeX = 6,
    //        sizeY = 12
    //    });

    //    string json = JsonUtility.ToJson(_grid);

    //    Debug.Log(json);

    //    Grid g = JsonUtility.FromJson<Grid>(json);

    //    GridUpdate update = new()
    //    {
    //        playerId = 0,
    //        playerName = "P1",
    //        updatedNodes = new()
    //    };

    //    update.updatedNodes.Add(new Node(Node.JewelType.Red, 0, 1));
    //    update.updatedNodes.Add(new Node(Node.JewelType.Green, 0, 2));
    //    update.updatedNodes.Add(new Node(Node.JewelType.Blue, 0, 3));
    //    update.updatedNodes.Add(new Node(Node.JewelType.None, 0, 4));

    //    string json2 = JsonUtility.ToJson(update);

    //    Debug.Log(json2);

    //    GridUpdate update2 = JsonUtility.FromJson<GridUpdate>(json2);
    //}
}