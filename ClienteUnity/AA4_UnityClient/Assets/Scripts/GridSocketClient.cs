using System;
using UnityEngine;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class GridSocketClient : MonoBehaviour
{
    [Header("Server connection")]
    public string serverUrlLink = "http://localhost:3000";

    [Header("Grid target")]
    public NodeGrid nodeGrid;

    private SocketIOUnity socket;

    private void Start()
    {
        var uri = new Uri(serverUrlLink);
        socket = new SocketIOUnity(uri);

        socket.OnConnected += (s, e) =>
        {
            Debug.Log($"[GridSocketClient] Connected to {serverUrlLink}");
        };

        socket.OnDisconnected += (s, e) =>
        {
            Debug.Log("[GridSocketClient] Disconnected");
        };

        // Ajusta los nombres de eventos a los que emita tu servidor
        socket.On("grid:setup", response =>
        {
            string json = response.ToString();
            var setup = JsonUtility.FromJson<NodeGrid.GridSetup>(json);

            MainThreadDispatcher.RunOnMainThread(() =>
            {
                if (nodeGrid != null) nodeGrid.SetupGrid(setup);
            });
        });

        socket.On("grid:update", response =>
        {
            string json = response.ToString();
            var update = JsonUtility.FromJson<NodeGrid.GridUpdate>(json);

            MainThreadDispatcher.RunOnMainThread(() =>
            {
                if (nodeGrid != null) nodeGrid.UpdateGrid(update);
            });
        });

        socket.Connect();
    }

    private void OnDestroy()
    {
        try { socket?.Dispose(); } catch { /* ignore */ }
    }
}