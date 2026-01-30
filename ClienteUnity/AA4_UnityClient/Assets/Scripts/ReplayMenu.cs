using System;
using UnityEngine;
using UnityEngine.UI;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class ReplayMenu : MonoBehaviour
{
    [Header("Referencias")]
    public SocketConnector connector;
    public MultiGridViewer gridViewer;

    [Header("Sala y UI")]
    public int roomId = 1;
    public Transform listContainer;
    public GameObject replayButtonPrefab;
    public GameObject panelMenu;
    public Button openMenuButton;
    public Button closeMenuButton;

    private SocketIOUnity socket;
    private readonly System.Collections.Generic.Queue<Action> _main = new();
    void EnqueueMain(Action a) { lock (_main) _main.Enqueue(a); }
    void Update() { lock (_main) { while (_main.Count > 0) _main.Dequeue()?.Invoke(); } }

    void Start()
    {
        if (connector == null) { Debug.LogError("[ReplayMenu] Falta SocketConnector"); return; }
        connector.EnsureConnected();
        socket = connector.Socket;

        socket.On("ListReplaysResponse", resp =>
        {
            var json = Extract(resp);
            Debug.Log("[ReplayMenu] ListReplaysResponse: " + json);
            try
            {
                var obj = JObject.Parse(json);
                if ((obj["status"]?.Value<string>() ?? "error") != "success") return;
                var arr = obj["data"] as JArray;
                if (arr == null) return;
                EnqueueMain(() => PopulateList(arr));
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[ReplayMenu] Parse error: " + ex.Message);
            }
        });

        socket.On("StartReplayResponse", resp =>
        {
            Debug.Log("[ReplayMenu] StartReplayResponse: " + Extract(resp));
        });

        socket.On("JoinReplayResponse", resp =>
        {
            Debug.Log("[ReplayMenu] JoinReplayResponse: " + Extract(resp));
        });

        if (openMenuButton) openMenuButton.onClick.AddListener(OpenMenu);
        if (closeMenuButton) closeMenuButton.onClick.AddListener(CloseMenu);
        if (panelMenu) panelMenu.SetActive(false);
    }

    public void OpenMenu()
    {
        if (panelMenu) panelMenu.SetActive(true);
        RequestList();
    }

    public void CloseMenu()
    {
        if (panelMenu) panelMenu.SetActive(false);
    }

    private void RequestList()
    {
        Debug.Log("[ReplayMenu] ListReplaysRequest roomId=" + roomId);
        socket.EmitAsync("ListReplaysRequest", roomId);
    }

    private void PopulateList(JArray replays)
    {
        if (listContainer == null)
        {
            Debug.LogError("[ReplayMenu] listContainer no asignado");
            return;
        }
        if (replayButtonPrefab == null)
        {
            Debug.LogError("[ReplayMenu] replayButtonPrefab no asignado");
            return;
        }

        // Limpia lista actual
        foreach (Transform child in listContainer) Destroy(child.gameObject);

        int created = 0;
        foreach (var item in replays)
        {
            int replayId = item["id"]?.Value<int>() ?? 0;
            string players = item["players"]?.Value<string>() ?? "";
            string createdAt = item["created_at"]?.ToString() ?? "";
            string status = item["status"]?.Value<string>() ?? "";

            if (replayId <= 0)
            {
                Debug.LogWarning("[ReplayMenu] Entrada sin id, se omite: " + item.ToString(Newtonsoft.Json.Formatting.None));
                continue;
            }

            // Instancia bajo el contenedor, manteniendo local transform
            GameObject btnGo = Instantiate(replayButtonPrefab);
            btnGo.transform.SetParent(listContainer, false);
            btnGo.SetActive(true);

            // Configuración del texto
            var unityText = btnGo.GetComponentInChildren<UnityEngine.UI.Text>();
            var tmpText = btnGo.GetComponentInChildren<TMPro.TMP_Text>();
            string label = $"Replay #{replayId} - {players} - {createdAt}";
            if (unityText) unityText.text = label;
            if (tmpText) tmpText.text = label;

            // Añade callback
            var btn = btnGo.GetComponent<UnityEngine.UI.Button>();
            if (btn != null)
            {
                int idCopy = replayId;
                btn.onClick.AddListener(() => StartReplay(idCopy));
            }
            else
            {
                Debug.LogWarning("[ReplayMenu] El prefab no tiene Button; no se puede clicar");
            }

            created++;
        }

        // Fuerza el relayout del contenedor
        var rt = listContainer as RectTransform;
        if (rt != null)
        {
            UnityEngine.UI.LayoutRebuilder.ForceRebuildLayoutImmediate(rt);
        }

        Debug.Log("[ReplayMenu] Botones creados: " + created);
    }

    private void StartReplay(int replayId)
    {
        Debug.Log("[ReplayMenu] StartReplay id=" + replayId);

        // Limpiar y habilitar recepción de updates
        if (gridViewer)
        {
            gridViewer.ClearAll();
            var viewerType = gridViewer.GetType();
            var field = viewerType.GetField("_acceptUpdates", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            if (field != null) field.SetValue(gridViewer, true);
        }

        socket.EmitAsync("JoinReplayChannel", replayId);
        socket.EmitAsync("StartReplayRequest", replayId);

        CloseMenu();
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