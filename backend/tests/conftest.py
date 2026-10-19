import os
from dotenv import load_dotenv

# Get the path to the root folder (sentinella-enterprise)
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Load the .env file from the root folder
load_dotenv(os.path.join(root_dir, ".env"))