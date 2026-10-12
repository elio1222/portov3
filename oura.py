import requests
from dotenv import set_key, load_dotenv
import webbrowser
import os
from urllib.parse import urlencode
from datetime import timedelta
from datetime import date


load_dotenv()

ENV_PATH = ".env"
HEADERS = {"Authorization": f"Bearer {os.getenv("ACCESS_TOKEN")}"}

def run():
    auth_params = {
        "client_id": os.getenv("CLIENT_ID"),
        "redirect_uri": "http://localhost:8000/callback",
        "response_type": "code",
        "scope": "daily heartrate personal stress"
    }

    auth_url = f"https://cloud.ouraring.com/oauth/authorize?{urlencode(auth_params)}"

    print(f"Please visit this URL to authorize: {auth_url}")
    webbrowser.open(auth_url)

def write_tokens(access_token, refresh_token):
    set_key(ENV_PATH, "ACCESS_TOKEN", access_token)
    set_key(ENV_PATH, "REFRESH_TOKEN", refresh_token)

def get_tokens(code: str):
    auth_code = code
    token_url = "https://api.ouraring.com/oauth/token"
    token_data = {
        "grant_type": "authorization_code",
        "code": auth_code,
        "client_id": os.getenv("CLIENT_ID"),
        "client_secret": os.getenv("CLIENT_SECRET"),
        "redirect_uri": "http://localhost:8000/callback"
    }
    response = requests.post(token_url, data=token_data)
    tokens = response.json()
    access_token = tokens["access_token"]
    refresh_token = tokens["refresh_token"]

    write_tokens(access_token, refresh_token)

def refresh_tokens() -> bool:
    try:
        token_url = "https://api.ouraring.com/oauth/token"
        token_data = {
            "grant_type": "refresh_token",
            "refresh_token": os.getenv("REFRESH_TOKEN"),
            "client_id": os.getenv("CLIENT_ID"),
            "client_secret": os.getenv("CLIENT_SECRET"),
        }
        response = requests.post(token_url, data=token_data)
        new_tokens = response.json()
       
        access_token = new_tokens.get("access_token")
        refresh_token = new_tokens.get("refresh_token")
        write_tokens(access_token, refresh_token)

        global HEADERS
        HEADERS = {"Authorization": f"Bearer {os.getenv("ACCESS_TOKEN")}"}

        return True

    except Exception as e:
        #print("REFRESH_TOKEN")
        print(e)
        return False
    
def shift_date(date: object):
    """Shifting date paramter by one day back"""
    return date - timedelta(days=1)

def param_builder(start_date: date, end_date: date) -> dict:
    return {
        "start_date": start_date,
        "end_date": end_date
    }

# whole function needs to be rewritten
def fetch_oura_data(url: str, params: dict, retries: int = 3) -> dict:
    headers = {
        "Authorization": f"Bearer {os.getenv('ACCESS_TOKEN')}"
    }

    try:
        for _ in range(retries):
            response = requests.get(url=url, headers=headers, params=params)
            #print("HIIII")
            # response.raise_for_status()

            data = response.json()

            #print(f"RESPONSE CODE {response.status_code}")

            if response.status_code == 200 and len(data["data"]) > 0 if data.get("data") else None:
                return data
            if response.status_code == 200:
                return data
            if response.status_code == 401:
                print("yo")
                refresh_tokens()
            if response.status_code == 403:
                return {"status_code": response.status_code, "description": "the requested resources requires additional permissions or the user's Oura subscription has expired."}
            if response.status_code == 429:
                return {"Message": "Wait 5 minutes for data retrieval"}
            
            if len(data["data"]) == 0:
                print(f"Paramters: {params} are not available yet.")
                params["start_date"] = shift_date(params["start_date"]) if params.get("start_date") else None
                params["end_date"] = shift_date(params["end_date"]) if params.get("end_date") else None

    except Exception as e:
        # this is a bug
        data = {
            "error": e
        }
        print(data)
        import json
        return json.dumps(data, indent=4)