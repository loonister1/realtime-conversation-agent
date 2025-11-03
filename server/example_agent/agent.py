import requests
from google.adk.agents import Agent
from google.genai.types import (
    GenerateContentConfig,
    HarmBlockThreshold,
    HarmCategory,
    SafetySetting,
)

from .prompts import AGENT_INSTRUCTION

def get_weather(latitude: float, longitude: float):
    """Fetch the weather for a given latitude and longitude."""
    url = f"https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current_weather=true"
    response = requests.get(url)
    return response.json()


genai_config = GenerateContentConfig(
    temperature=0.5
)

root_agent = Agent(
   name="example_agent",
   model="gemini-live-2.5-flash-preview-native-audio",
   description="A helpful AI assistant.",
   instruction=AGENT_INSTRUCTION,
   tools=[get_weather]
)
