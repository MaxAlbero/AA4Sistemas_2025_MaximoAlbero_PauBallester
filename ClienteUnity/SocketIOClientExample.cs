using System;
using System.Collections.Generic;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;
using UnityEngine;
using UnityEngine.UI;
using Newtonsoft.Json.Linq;

public class SocketIOClientExample : MonoBehaviour
{
    public SocketIOUnity socket;
    public string serverUrlLink = "http://192.168.1.75:3000/";

    // Start is called once before the first execution of Update after the MonoBehaviour is created
    void Start()
    {
        var uri = new Uri(serverUrlLink);
        socket = new SocketIOUnity(uri);

        socket.OnConnected += (sender, e) =>
        {
            Debug.Log("socket.OnConnected");
        };

        socket.On("message", response =>
        {
            Debug.Log("Event" + response.ToString());
            Debug.Log(response.GetValue<string>());
        });

        socket.Connect();
    }

    // Update is called once per frame
    void Update()
    {
        if (Input.GetKeyDown(KeyCode.Space))
        {
            socket.EmitAsync("message", "Hello, server!"); // replace with your message
        }
    }

    void OnDestroy()
    {
        socket.Dispose();
    }
}
