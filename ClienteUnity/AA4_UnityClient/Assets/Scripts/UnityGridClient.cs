using System;
using SocketIOClient;
using UnityEngine;

public class UnityGridClient : MonoBehaviour
{
    public string serverUrl = "http://192.168.1.75:3000/";
    public string roomId = "1";
    public string playerName = "UnityPlayer";
    public int playerId = 1001;

    private SocketIOUnity socket;

    void Start()
    {
        socket = new SocketIOUnity(new Uri(serverUrl));
        socket.OnConnected += (s, e) => {
            Debug.Log("Connected, registering as unity");
            socket.EmitAsync("registerClientType", "unity");
            JoinRoom();
        };

        socket.On("setupGrid", resp => {
            var payload = resp.GetValue<string>();
            Debug.Log($"setupGrid: {payload}");
        });

        socket.On("updateGrid", resp => {
            var payload = resp.GetValue<string>();
            Debug.Log($"updateGrid: {payload}");
        });

        socket.On("pauseState", resp => {
            var pausedJson = resp.GetValue<string>();
            Debug.Log($"pauseState: {pausedJson}");
        });

        socket.Connect();
    }

    public async void JoinRoom()
    {
        var data = new
        {
            roomId = roomId,
            playerId = playerId,
            playerName = playerName
        };
        await socket.EmitAsync("joinRoom", JsonUtility.ToJson(data));
    }

    public async void LeaveRoom()
    {
        var data = new { roomId = roomId, playerId = playerId };
        await socket.EmitAsync("leaveRoom", JsonUtility.ToJson(data));
    }

    void OnDestroy()
    {
        LeaveRoom();
        socket?.Dispose();
    }
}