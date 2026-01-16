using System;
using System.Collections.Generic;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;
using UnityEngine;
using UnityEngine.UI;
using Newtonsoft.Json.Linq;
public class SocketIOExample : MonoBehaviour
{
    public SocketIOUnity socket;
    public string serverUrlLink = "http://192.168.1.75:3000";
    // Start is called once before the first execution of Update after the MonoBehaviour is created
    void Start()
    {
        var uri = new Uri(serverUrlLink);
        socket = new SocketIOUnity(uri);

        socket.OnConnected += (sender, e) =>
        {
            Debug.Log("Socket conectado correctamente!");
        };

        socket.OnDisconnected += (sender, e) =>
        {
            Debug.Log("Socket desconectado");
        };

        // Manejador del evento "message"
        socket.On("message", response =>
        {
            Debug.Log("Mensaje recibido del servidor:");
            Debug.Log(response.GetValue<string>());
        });

        socket.Connect();
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.Space))
        {
            Debug.Log("Enviando mensaje al servidor...");
            socket.Emit("message", "Hello from Unity client!");
        }
    }

    void OnDestroy()
    {
        if (socket != null)
        {
            socket.Disconnect();
            socket.Dispose();
        }
    }
}
