import time
import psutil
import requests

API_URL = "http://localhost:8000/telemetry/"

def run_sentinella_agent():
    print("🚀 Sentinella System Agent is active and streaming telemetry...")
    while True:
        # Gather comprehensive hardware stats
        cpu_total = psutil.cpu_percent(interval=1)
        ram_info = psutil.virtual_memory()
        
        status = "Critical" if cpu_total > 85 or ram_info.percent > 85 else "Normal"
        
        payload = {
            "node_name": "host-workstation-agent",
            "cpu_usage_percent": cpu_total,
            "memory_usage_percent": ram_info.percent,
            "status": status,
            "extra_metadata": {
                "os": psutil.os.name,
                "available_ram_gb": round(ram_info.available / (1024**3), 2),
                "cpu_cores": psutil.cpu_count(logical=True)
            }
        }
        
        try:
            response = requests.post(API_URL, json=payload)
            print(f"[{time.strftime('%X️')}] Pushed telemetry — Status: {response.status_code} | CPU: {cpu_total}% | RAM: {ram_info.percent}%")
        except Exception as e:
            print(f"❌ Failed to reach Sentinella API: {e}")
            
        time.sleep(5)

if __name__ == "__main__":
    run_sentinella_agent()