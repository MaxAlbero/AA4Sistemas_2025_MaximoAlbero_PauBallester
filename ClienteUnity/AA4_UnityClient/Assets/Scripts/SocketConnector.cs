using System;
using System.Collections.Generic;
using UnityEngine;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;

public class SocketConnector : MonoBehaviour
{
    [Header("Servidor")]
    public string serverUrlLink = "http://localhost:3000";
    public bool connectOnAwake = true;

    public SocketIOUnity Socket { get; private set; }

    private void Awake()
    {
        var uri = new Uri(serverUrlLink);
        var opts = new SocketIOOptions
        {
            Query = new Dictionary<string, string> { ["viewer"] = "1" }
        };
        Socket = new SocketIOUnity(uri, opts);

        Socket.OnConnected += (s, e) => Debug.Log("[SocketConnector] Conectado (viewer)");
        Socket.OnDisconnected += (s, e) => Debug.Log("[SocketConnector] Desconectado");
        Socket.OnReconnectAttempt += (s, attempt) => Debug.Log("[SocketConnector] Reintento " + attempt);
        Socket.OnError += (s, e) => Debug.LogWarning("[SocketConnector] Error: " + e);
        Socket.On("connect_error", resp => Debug.LogWarning("[SocketConnector] connect_error: " + resp.ToString()));

        if (connectOnAwake)
            Socket.Connect();
    }

    public void EnsureConnected()
    {
        if (Socket == null) return;
        if (!Socket.Connected) Socket.Connect();
    }
}