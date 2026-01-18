#!/usr/bin/env python3
"""
Firebase Base Service

Base class for all Firebase services with shared initialization logic.
"""

import os
import firebase_admin
from firebase_admin import credentials, firestore, storage


class FirebaseBaseService:
    """Base service for Firebase operations with shared initialization"""
    
    def __init__(self):
        self._init_firebase()
        self.db = firestore.client()
        self.bucket = storage.bucket()
    
    def _init_firebase(self):
        """Initialize Firebase Admin SDK"""
        if not firebase_admin._apps:
            # Check if running locally (has .env.local file) or in Cloud Run
            is_local = os.path.exists('.env.local') or os.getenv('FIREBASE_PRIVATE_KEY')
            is_cloud_run = os.environ.get('K_SERVICE') is not None
            
            # For local development, use explicit credentials from .env.local
            if is_local and not is_cloud_run:
                private_key = os.getenv("FIREBASE_PRIVATE_KEY")
                if not private_key:
                    raise ValueError("FIREBASE_PRIVATE_KEY environment variable is not set")
                
                # Handle the private key formatting
                private_key = private_key.replace('\\n', '\n')
                
                cred_dict = {
                    "type": "service_account",
                    "project_id": os.getenv("FIREBASE_PROJECT_ID"),
                    "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
                    "private_key": private_key,
                    "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
                    "client_id": os.getenv("FIREBASE_CLIENT_ID"),
                    "auth_uri": os.getenv("FIREBASE_AUTH_URI", "https://accounts.google.com/o/oauth2/auth"),
                    "token_uri": os.getenv("FIREBASE_TOKEN_URI", "https://oauth2.googleapis.com/token")
                }
                
                storage_bucket = os.getenv("FIREBASE_STORAGE_BUCKET") or f"{os.getenv('FIREBASE_PROJECT_ID')}.appspot.com"
                
                cred = credentials.Certificate(cred_dict)
                firebase_admin.initialize_app(cred, {
                    'storageBucket': storage_bucket
                })
                print("Firebase initialized with explicit credentials (local dev)")
                return
            
            # For Cloud Run, use Application Default Credentials (service account)
            try:
                cred = credentials.ApplicationDefault()
                storage_bucket = os.getenv("FIREBASE_STORAGE_BUCKET") or f"{os.getenv('FIREBASE_PROJECT_ID')}.appspot.com"
                firebase_admin.initialize_app(cred, {
                    'storageBucket': storage_bucket
                })
                print("Firebase initialized with Application Default Credentials (Cloud Run)")
                return
            except Exception as e:
                raise RuntimeError(
                    f"Failed to initialize Firebase with Application Default Credentials: {e}\n"
                    "For local development, ensure .env.local file exists with FIREBASE_PRIVATE_KEY.\n"
                    "For Cloud Run, ensure service account has proper permissions."
                ) from e





