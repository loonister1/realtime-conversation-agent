import asyncio
import base64
import json
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket
from starlette.websockets import WebSocketDisconnect

from google import genai
from google.genai import types

# Load environment variables
load_dotenv()

# Configure the Gemini client
client = genai.Client(
    http_options={"api_version": "v1beta"},
    api_key=os.environ.get("GEMINI_API_KEY"),
)

# Configuration for the live connection
LIVE_CONNECT_CONFIG = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    media_resolution="MEDIA_RESOLUTION_MEDIUM",
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Zephyr")
        )
    ),
    context_window_compression=types.ContextWindowCompressionConfig(
        trigger_tokens=25600,
        sliding_window=types.SlidingWindow(target_tokens=12800),
    ),
    input_audio_transcription={},
    output_audio_transcription=types.AudioTranscriptionConfig(),
)

MODEL_NAME = "models/gemini-2.5-flash-native-audio-preview-09-2025"

app = FastAPI()

logging.basicConfig(level=logging.INFO)


async def forward_client_to_gemini(websocket: WebSocket, session):
    """Receives messages from the client and forwards them to the Gemini session."""
    try:
        while True:
            message_json = await websocket.receive_text()
            message = json.loads(message_json)
            mime_type = message.get("mime_type")
            data = message.get("data")

            if not mime_type or not data:
                logging.warning(f"Invalid message from client: {message}")
                continue

            if mime_type == "text/plain":
                await session.send(input=data, end_of_turn=True)
            elif mime_type in ["audio/pcm", "image/jpeg"]:
                decoded_data = base64.b64decode(data)
                await session.send(input={"data": decoded_data, "mime_type": mime_type})
            else:
                logging.warning(f"Unsupported mime type from client: {mime_type}")

    except WebSocketDisconnect:
        logging.info("Client disconnected.")
    except Exception as e:
        logging.error(f"Error in forward_client_to_gemini: {e}")


async def forward_gemini_to_client(websocket: WebSocket, session):
    """Receives messages from the Gemini session and forwards them to the client."""
    try:
        while True:
            turn = session.receive()
            async for response in turn:
                message_to_send = {
                    "parts": [],
                    "output_transcription": None,
                    "input_transcription": None,
                    "turn_complete": False,
                }

                if hasattr(response, "server_content"):
                    # Handle transcriptions
                    if (
                        hasattr(response.server_content, "input_transcription")
                        and response.server_content.input_transcription
                    ):
                        is_final = (
                            response.server_content.input_transcription.is_final
                            if hasattr(response.server_content.input_transcription, "is_final")
                            else False
                        )
                        message_to_send["input_transcription"] = {
                            "text": response.server_content.input_transcription.text,
                            "is_final": is_final,
                        }

                    if (
                        hasattr(response.server_content, "output_transcription")
                        and response.server_content.output_transcription
                    ):
                        message_to_send["output_transcription"] = {
                            "text": response.server_content.output_transcription.text
                        }

                    # Handle parts (audio, text)
                    if hasattr(response.server_content, "model_turn") and hasattr(response.server_content.model_turn, "parts"):
                        for part in response.server_content.model_turn.parts:
                            if hasattr(part, "text") and part.text:
                                message_to_send["parts"].append(
                                    {"type": "text", "data": part.text}
                                )
                            if hasattr(part, "inline_data") and part.inline_data:
                                encoded_audio = base64.b64encode(
                                    part.inline_data.data
                                ).decode("ascii")
                                message_to_send["parts"].append(
                                    {"type": "audio/pcm", "data": encoded_audio}
                                )

                if message_to_send["parts"] or message_to_send["output_transcription"] or message_to_send["input_transcription"]:
                    await websocket.send_text(json.dumps(message_to_send))

            # Signal that the turn is complete
            await websocket.send_text(json.dumps({"turn_complete": True}))

    except WebSocketDisconnect:
        logging.info("Client disconnected, stopping forward_gemini_to_client.")
    except Exception as e:
        logging.error(f"Error in forward_gemini_to_client: {e}")


@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """Main WebSocket endpoint for handling client-server communication."""
    await websocket.accept()
    logging.info(f"Client #{user_id} connected.")

    try:
        async with client.aio.live.connect(
            model=MODEL_NAME, config=LIVE_CONNECT_CONFIG
        ) as session:
            logging.info(f"Started Gemini session for client #{user_id}")

            client_to_gemini_task = asyncio.create_task(
                forward_client_to_gemini(websocket, session)
            )
            gemini_to_client_task = asyncio.create_task(
                forward_gemini_to_client(websocket, session)
            )

            # Wait for either task to complete (e.g., due to disconnection)
            done, pending = await asyncio.wait(
                [client_to_gemini_task, gemini_to_client_task],
                return_when=asyncio.FIRST_COMPLETED,
            )

            # Cancel any pending tasks to ensure clean shutdown
            for task in pending:
                task.cancel()

    except Exception as e:
        logging.error(f"An error occurred in websocket_endpoint for client #{user_id}: {e}")
    finally:
        logging.info(f"Client #{user_id} disconnected.")
