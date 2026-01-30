using System;
using UnityEngine;
using UnityEngine.UI;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class RoomsMenu : MonoBehaviour
{
    [Header("Referencias")]
    public SocketConnector connector;
    public MultiGridViewer gridViewer;

    [Header("UI")]
    public GameObject panelRooms;          // panel del menú de salas
    public Transform listContainer;        // contenedor para los botones
    public GameObject roomButtonPrefab;    // prefab con Button + Text/TMP_Text
    public Button openRoomsButton;         // botón para abrir el menú
    public Button closeRoomsButton;        // botón para cerrar el menú
    public Button leaveRoomButton;         // botón “Salir de sala”

    private SocketIOUnity socket;
    private readonly System.Collections.Generic.Queue<Action> _main = new();
    void EnqueueMain(Action a) { lock (_main) _main.Enqueue(a); }
    void Update() { lock (_main) { while (_main.Count > 0) _main.Dequeue()?.Invoke(); } }

    void Start()
    {
        if (connector == null) { Debug.LogError("[RoomsMenu] Falta SocketConnector"); return; }
        connector.EnsureConnected();
        socket = connector.Socket;

        // Escucha todo y enruta específicamente ChatRoomsData
        socket.OnAny((eventName, response) =>
        {
            var raw = Extract(response);
            Debug.Log("[RoomsMenu] OnAny event=" + eventName + " payload=" + raw);

            if (eventName == "ChatRoomsData")
            {
                try
                {
                    // El servidor emite un array JSON como string
                    var arr = Newtonsoft.Json.Linq.JArray.Parse(raw);
                    // Encolar en hilo principal
                    EnqueueMain(() =>
                    {
                        Debug.Log("[RoomsMenu] PopulateRooms con " + arr.Count + " salas");
                        PopulateRooms(arr);
                    });
                }
                catch (System.Exception ex)
                {
                    Debug.LogWarning("[RoomsMenu] Parse ChatRoomsData error: " + ex.Message + " payload=" + raw);
                }
            }
        });

        if (openRoomsButton) openRoomsButton.onClick.AddListener(OpenRoomsMenu);
        if (closeRoomsButton) closeRoomsButton.onClick.AddListener(CloseRoomsMenu);
        if (leaveRoomButton) leaveRoomButton.onClick.AddListener(OnLeaveRoom);

        if (panelRooms) panelRooms.SetActive(false);
    }

    public void OpenRoomsMenu()
    {
        if (panelRooms) panelRooms.SetActive(true);
        connector.EnsureConnected();
        RequestRoomsList();
    }


    public void CloseRoomsMenu()
    {
        if (panelRooms) panelRooms.SetActive(false);
    }

    private void RequestRoomsList()
    {
        Debug.Log("[RoomsMenu] GetRoomsRequest");
        socket.EmitAsync("GetRoomsRequest");
    }

    private void PopulateRooms(Newtonsoft.Json.Linq.JArray rooms)
    {
        if (listContainer == null)
        {
            Debug.LogError("[RoomsMenu] listContainer no asignado");
            return;
        }
        if (roomButtonPrefab == null)
        {
            Debug.LogError("[RoomsMenu] roomButtonPrefab no asignado");
            return;
        }

        foreach (Transform child in listContainer) Destroy(child.gameObject);

        int created = 0;
        foreach (var item in rooms)
        {
            int id = item["id"]?.Value<int>() ?? 0;
            string name = item["name"]?.Value<string>() ?? $"Sala {id}";
            if (id <= 0) continue;

            GameObject btnGo = Instantiate(roomButtonPrefab);
            btnGo.transform.SetParent(listContainer, false);
            btnGo.SetActive(true);

            var unityText = btnGo.GetComponentInChildren<UnityEngine.UI.Text>();
            var tmpText = btnGo.GetComponentInChildren<TMPro.TMP_Text>();
            string label = $"{name} (#{id})";
            if (unityText) unityText.text = label;
            if (tmpText) tmpText.text = label;

            var btn = btnGo.GetComponent<UnityEngine.UI.Button>();
            if (btn != null)
            {
                int idCopy = id;
                btn.onClick.AddListener(() => OnJoinRoomClicked(idCopy));
                created++;
            }
            else
            {
                Debug.LogWarning("[RoomsMenu] El prefab no tiene Button; no será clicable");
            }
        }

        var rt = listContainer as RectTransform;
        if (rt != null) UnityEngine.UI.LayoutRebuilder.ForceRebuildLayoutImmediate(rt);

        Debug.Log("[RoomsMenu] Botones de salas creados: " + created);
    }

    private void OnJoinRoomClicked(int roomId)
    {
        Debug.Log("[RoomsMenu] JoinRoom " + roomId);
        if (gridViewer != null)
        {
            // Sal de la sala actual si hay
            gridViewer.LeaveRoom();
            // Únete a la nueva
            gridViewer.JoinRoom(roomId);
        }
        CloseRoomsMenu();
    }

    private void OnLeaveRoom()
    {
        if (gridViewer != null)
        {
            gridViewer.LeaveRoom(); // ahora SIEMPRE limpia y deja de aceptar updates
        }
        OpenRoomsMenu(); // muestra lista de salas
    }

    private string Extract(SocketIOResponse response)
    {
        try { return response.GetValue<string>(); }
        catch
        {
            try { return response.GetValue<JToken>().ToString(Newtonsoft.Json.Formatting.None); }
            catch { return response.ToString(); }
        }
    }
}