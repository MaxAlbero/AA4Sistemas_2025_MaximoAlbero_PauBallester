using System;
using System.Collections.Generic;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;
using UnityEngine;

public class SocketIOExample : MonoBehaviour
{
    [Header("Socket Configuration")]
    public SocketIOUnity socket;
    public string serverUrlLink = "http://192.168.1.75:3000";

    [Header("References")]
    [SerializeField] private NodeGrid nodeGrid;

    private int currentPlayerId = -1;
    private string currentPlayerName = "";
    private string currentRoom = "";

    void Start()
    {
        if (nodeGrid == null)
        {
            nodeGrid = FindObjectOfType<NodeGrid>();
        }

        // Asegurar que MainThreadDispatcher existe
        var dispatcher = MainThreadDispatcher.Instance;

        var uri = new Uri(serverUrlLink);
        socket = new SocketIOUnity(uri);

        socket.OnConnected += (sender, e) =>
        {
            MainThreadDispatcher.RunOnMainThread(() =>
            {
                Debug.Log("Socket conectado correctamente!");
            });
        };

        socket.OnDisconnected += (sender, e) =>
        {
            MainThreadDispatcher.RunOnMainThread(() =>
            {
                Debug.Log("Socket desconectado");
            });
        };

        // === EVENTO: Configurar Grid ===
        socket.On("setupGrid", response =>
        {
            string json = response.GetValue<string>();

            // IMPORTANTE: Ejecutar en el hilo principal
            MainThreadDispatcher.RunOnMainThread(() =>
            {
                Debug.Log("Recibido setupGrid del servidor");

                try
                {
                    Debug.Log("JSON recibido: " + json);

                    NodeGrid.GridSetup setup = JsonUtility.FromJson<NodeGrid.GridSetup>(json);
                    nodeGrid.SetupGrid(setup);

                    Debug.Log($"Grid creado para jugador {setup.playerName} (ID: {setup.playerId})");
                }
                catch (Exception ex)
                {
                    Debug.LogError("Error al procesar setupGrid: " + ex.Message);
                    Debug.LogError(ex.StackTrace);
                }
            });
        });

        // === EVENTO: Actualizar Grid ===
        socket.On("updateGrid", response =>
        {
            string json = response.GetValue<string>();

            MainThreadDispatcher.RunOnMainThread(() =>
            {
                Debug.Log("Recibido updateGrid del servidor");

                try
                {
                    Debug.Log("JSON recibido: " + json);

                    NodeGrid.GridUpdate update = JsonUtility.FromJson<NodeGrid.GridUpdate>(json);
                    nodeGrid.UpdateGrid(update);

                    Debug.Log($"Grid actualizado para jugador ID {update.playerId}");
                }
                catch (Exception ex)
                {
                    Debug.LogError("Error al procesar updateGrid: " + ex.Message);
                    Debug.LogError(ex.StackTrace);
                }
            });
        });

        socket.On("removePlayer", response =>
        {
            int playerId = response.GetValue<int>();

            MainThreadDispatcher.RunOnMainThread(() =>
            {
                Debug.Log("Recibido removePlayer del servidor");
                nodeGrid.RemovePlayerGrid(playerId);
            });
        });

        socket.On("clearAllGrids", response =>
        {
            MainThreadDispatcher.RunOnMainThread(() =>
            {
                Debug.Log("Recibido clearAllGrids del servidor");
                nodeGrid.ClearAllGrids();
            });
        });

        socket.On("message", response =>
        {
            string msg = response.GetValue<string>();
            MainThreadDispatcher.RunOnMainThread(() =>
            {
                Debug.Log("Mensaje del servidor: " + msg);
            });
        });

        socket.Connect();
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.J))
        {
            JoinTestRoom();
        }

        if (Input.GetKeyDown(KeyCode.U))
        {
            SendTestUpdate();
        }

        if (Input.GetKeyDown(KeyCode.L))
        {
            LeaveTestRoom();
        }
    }

    private void JoinTestRoom()
    {
        currentRoom = "testRoom1";
        currentPlayerId = UnityEngine.Random.Range(0, 1000);
        currentPlayerName = "TestPlayer_" + UnityEngine.Random.Range(0, 100);

        string joinJson = JsonUtility.ToJson(new JoinRoomData
        {
            roomId = currentRoom,
            playerId = currentPlayerId,
            playerName = currentPlayerName
        });

        Debug.Log($"Uniéndose a sala: {currentRoom} como {currentPlayerName} (ID: {currentPlayerId})");
        Debug.Log($"JSON enviado: {joinJson}");

        socket.Emit("joinRoom", joinJson);
    }

    private void SendTestUpdate()
    {
        if (currentPlayerId == -1)
        {
            Debug.LogWarning("Debes unirte a una sala primero (presiona J)");
            return;
        }

        NodeGrid.GridUpdate update = new NodeGrid.GridUpdate
        {
            playerId = currentPlayerId,
            playerName = currentPlayerName,
            updatedNodes = new List<NodeGrid.Node>
            {
                new NodeGrid.Node(NodeGrid.Node.JewelType.Red, 0, 0),
                new NodeGrid.Node(NodeGrid.Node.JewelType.Green, 0, 1),
                new NodeGrid.Node(NodeGrid.Node.JewelType.Blue, 0, 2),
                new NodeGrid.Node(NodeGrid.Node.JewelType.Yellow, 1, 0)
            }
        };

        string updateJson = JsonUtility.ToJson(new GameUpdateData
        {
            roomId = currentRoom,
            gridUpdate = update
        });

        Debug.Log("Enviando actualización de prueba");
        Debug.Log($"JSON enviado: {updateJson}");

        socket.Emit("gameUpdate", updateJson);
    }

    private void LeaveTestRoom()
    {
        if (currentPlayerId == -1)
        {
            Debug.LogWarning("No estás en ninguna sala");
            return;
        }

        string leaveJson = JsonUtility.ToJson(new LeaveRoomData
        {
            roomId = currentRoom,
            playerId = currentPlayerId
        });

        Debug.Log("Saliendo de la sala");
        socket.Emit("leaveRoom", leaveJson);

        currentPlayerId = -1;
        currentPlayerName = "";
        currentRoom = "";
    }

    void OnDestroy()
    {
        if (socket != null)
        {
            socket.Disconnect();
            socket.Dispose();
        }
    }

    [Serializable]
    private class JoinRoomData
    {
        public string roomId;
        public int playerId;
        public string playerName;
    }

    [Serializable]
    private class GameUpdateData
    {
        public string roomId;
        public NodeGrid.GridUpdate gridUpdate;
    }

    [Serializable]
    private class LeaveRoomData
    {
        public string roomId;
        public int playerId;
    }
}