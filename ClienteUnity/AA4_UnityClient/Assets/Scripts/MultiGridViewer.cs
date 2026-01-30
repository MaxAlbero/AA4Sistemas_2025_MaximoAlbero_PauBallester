using System;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class MultiGridViewer : MonoBehaviour
{
    [Header("Referencias")]
    public SocketConnector connector;

    [Header("Sala")]
    public int roomId = 1;
    public bool autoJoinFirstRoom = false;

    [Header("Slots del editor (opcional)")]
    public Transform slotLeft;
    public Transform slotCenter;
    public Transform slotRight;

    private SocketIOUnity socket;
    private readonly Dictionary<int, (GameObject wrapper, NodeGrid grid)> _grids = new();
    private readonly Queue<Action> _mainQueue = new();

    private void EnqueueMain(Action a) { lock (_mainQueue) _mainQueue.Enqueue(a); }
    private void Update()
    {
        lock (_mainQueue) { while (_mainQueue.Count > 0) _mainQueue.Dequeue()?.Invoke(); }
    }

    private void Start()
    {
        if (connector == null) { Debug.LogError("[MultiGridViewer] Falta SocketConnector"); return; }
        connector.EnsureConnected();
        socket = connector.Socket;

        socket.OnConnected += (s, e) =>
        {
            Debug.Log("[MultiGridViewer] Conectado como viewer");
            if (!autoJoinFirstRoom && roomId > 0)
            {
                Debug.Log("[MultiGridViewer] Uniendo a sala " + roomId);
                socket.EmitAsync("JoinRoomRequest", roomId);
            }
        };

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
                        Debug.Log("[MultiGridViewer] Auto-join sala " + roomId);
                        socket.EmitAsync("JoinRoomRequest", roomId);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[MultiGridViewer] Parse ChatRoomsData: " + ex.Message);
            }
        });

        socket.On("JoinRoomResponse", resp =>
        {
            var raw = ExtractPayloadString(resp);
            Debug.Log("[MultiGridViewer] JoinRoomResponse: " + raw);
        });

        socket.On("setupGrid", resp =>
        {
            var json = ExtractPayloadString(resp);
            Debug.Log("[MultiGridViewer] setupGrid: " + json);
            var setup = JsonUtility.FromJson<NodeGrid.GridSetup>(json);
            EnqueueMain(() =>
            {
                EnsureGridForPlayer(setup.playerId);
                var (wrapper, grid) = _grids[setup.playerId];
                grid.SetupGrid(setup);
                UpdateLayout();
            });
        });

        socket.On("updateGrid", resp =>
        {
            var json = ExtractPayloadString(resp);
            var update = JsonUtility.FromJson<NodeGrid.GridUpdate>(json);
            EnqueueMain(() =>
            {
                if (_grids.TryGetValue(update.playerId, out var pair))
                {
                    pair.grid.UpdateGrid(update);
                }
                else
                {
                    EnsureGridForPlayer(update.playerId);
                    Debug.LogWarning("[MultiGridViewer] update para playerId desconocido: " + update.playerId);
                    UpdateLayout();
                }
            });
        });
    }

    public void ClearAll()
    {
        var keys = new List<int>(_grids.Keys);
        foreach (var pid in keys)
        {
            var wrap = _grids[pid].wrapper;
            if (wrap) Destroy(wrap);
            _grids.Remove(pid);
        }
    }

    private void EnsureGridForPlayer(int playerId)
    {
        if (_grids.ContainsKey(playerId)) return;
        var wrapper = new GameObject($"GridWrapper_{playerId}");
        // Por defecto al centro
        if (slotCenter != null) wrapper.transform.SetParent(slotCenter, false);
        else wrapper.transform.SetParent(this.transform, false);
        wrapper.transform.localPosition = Vector3.zero;

        var gridGo = new GameObject($"Grid_{playerId}");
        gridGo.transform.SetParent(wrapper.transform, false);

        var grid = gridGo.AddComponent<NodeGrid>();
        _grids[playerId] = (wrapper, grid);
    }

    private void UpdateLayout()
    {
        int count = _grids.Count;
        if (count == 0) return;

        if (count == 1)
        {
            var only = _grids.Values.First().wrapper;
            if (slotCenter) { only.transform.SetParent(slotCenter, false); only.transform.localPosition = Vector3.zero; }
        }
        else if (count == 2)
        {
            var ordered = _grids.Keys.OrderBy(k => k).ToArray();
            var leftWrap = _grids[ordered[0]].wrapper;
            var rightWrap = _grids[ordered[1]].wrapper;
            if (slotLeft) { leftWrap.transform.SetParent(slotLeft, false); leftWrap.transform.localPosition = Vector3.zero; }
            if (slotRight) { rightWrap.transform.SetParent(slotRight, false); rightWrap.transform.localPosition = Vector3.zero; }
        }
    }

    private string ExtractPayloadString(SocketIOResponse response)
    {
        try { return response.GetValue<string>(); }
        catch
        {
            try { return response.GetValue<JToken>().ToString(Newtonsoft.Json.Formatting.None); }
            catch { return response.ToString(); }
        }
    }
}