using System;
using System.Collections.Generic;
using UnityEngine;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class MultiGridViewer : MonoBehaviour
{
    [Header("Server")]
    public string serverUrlLink = "http://localhost:3000";
    public int roomId = 1; // set to the room you want to visualize
    public bool autoJoinFirstRoom = false; // true to join the first room from ChatRoomsData

    [SerializeField] GameObject gridParent;

    private SocketIOUnity socket;

    // playerId -> NodeGrid
    private readonly Dictionary<int, NodeGrid> gridsByPlayer = new();

    // Simple main-thread dispatcher
    private readonly Queue<Action> _mainQueue = new();

    private void EnqueueMain(Action a)
    {
        lock (_mainQueue) _mainQueue.Enqueue(a);
    }

    private void Update()
    {
        lock (_mainQueue)
        {
            while (_mainQueue.Count > 0) _mainQueue.Dequeue()?.Invoke();
        }
    }

    private void Start()
    {
        var uri = new Uri(serverUrlLink);
        var opts = new SocketIOOptions
        {
            Query = new Dictionary<string, string> { ["viewer"] = "1" } // mark as spectator
        };
        socket = new SocketIOUnity(uri, opts);

        socket.OnConnected += (s, e) =>
        {
            Debug.Log("[MultiGridViewer] Connected as viewer");
            // If we know the roomId, join it now; otherwise wait for ChatRoomsData
            if (!autoJoinFirstRoom && roomId > 0)
            {
                Debug.Log("[MultiGridViewer] Joining room " + roomId);
                socket.EmitAsync("JoinRoomRequest", roomId);
            }
        };

        // Rooms list (if you want to auto-join first room)
        socket.On("ChatRoomsData", resp =>
        {
            if (!autoJoinFirstRoom) return;
            try
            {
                var json = ExtractPayloadString(resp);
                var arr = JArray.Parse(json);
                if (arr.Count > 0)
                {
                    var firstId = arr[0]["id"]?.Value<int>() ?? 0;
                    if (firstId > 0)
                    {
                        roomId = firstId;
                        Debug.Log("[MultiGridViewer] Auto-joining first room " + roomId);
                        socket.EmitAsync("JoinRoomRequest", roomId);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[MultiGridViewer] ChatRoomsData parse warning: " + ex.Message);
            }
        });

        // Join confirmation
        socket.On("JoinRoomResponse", resp =>
        {
            var raw = ExtractPayloadString(resp);
            Debug.Log("[MultiGridViewer] JoinRoomResponse: " + raw);
        });

        // Game setup per player
        socket.On("setupGrid", resp =>
        {
            var json = ExtractPayloadString(resp);
            Debug.Log("[MultiGridViewer] setupGrid payload: " + json);
            var setup = JsonUtility.FromJson<NodeGrid.GridSetup>(json);

            EnqueueMain(() =>
            {
                if (!gridsByPlayer.TryGetValue(setup.playerId, out var grid))
                {
                    var go = new GameObject($"Grid_{setup.playerId}");
                    // Position left/right or stacked so both grids are visible
                    var offsetX = (setup.playerId % 2 == 0) ? -5f : 5f;
                    go.transform.position = new Vector3(offsetX, 0f, 0f);
                    grid = go.AddComponent<NodeGrid>();
                    gridsByPlayer[setup.playerId] = grid;
                }
                grid.SetupGrid(setup);

                grid.transform.SetParent(gridParent.transform);
            });
        });

        // Game updates per player
        socket.On("updateGrid", resp =>
        {
            var json = ExtractPayloadString(resp);
            // Optional: log once to confirm events flow; comment later to reduce noise
            // Debug.Log("[MultiGridViewer] updateGrid payload: " + json);

            var update = JsonUtility.FromJson<NodeGrid.GridUpdate>(json);

            EnqueueMain(() =>
            {
                if (gridsByPlayer.TryGetValue(update.playerId, out var grid))
                {
                    grid.UpdateGrid(update);
                }
                else
                {
                    // Late spectator: grid not created yet? Request a re-setup or wait for next setup/full snapshot
                    Debug.LogWarning("[MultiGridViewer] update for unknown playerId=" + update.playerId);
                }
            });
        });

        socket.Connect();
    }

    private string ExtractPayloadString(SocketIOResponse response)
    {
        try { return response.GetValue<string>(); }
        catch
        {
            try
            {
                var token = response.GetValue<JToken>();
                return token.ToString(Newtonsoft.Json.Formatting.None);
            }
            catch { return response.ToString(); }
        }
    }
}