import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import User
from app.core.security import hash_password, create_access_token

@pytest.mark.asyncio
async def test_login_success(client: AsyncClient, db_session: AsyncSession) -> None:
    # 1. Create a user directly in DB
    user = User(
        email="login@example.com",
        full_name="Login User",
        hashed_password=hash_password("securepassword123"),
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()

    # 2. Test login
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "login@example.com", "password": "securepassword123"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient, db_session: AsyncSession) -> None:
    # 1. Create a user directly in DB
    user = User(
        email="login2@example.com",
        full_name="Login User 2",
        hashed_password=hash_password("securepassword123"),
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()

    # 2. Test login with wrong password
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "login2@example.com", "password": "wrongpassword"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_me(client: AsyncClient, db_session: AsyncSession) -> None:
    # 1. Create a user directly in DB
    user = User(
        email="me@example.com",
        full_name="Me User",
        hashed_password=hash_password("securepassword123"),
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # 2. Generate token
    token = create_access_token(user.id)

    # 3. Test get me
    response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.json()["email"] == "me@example.com"


@pytest.mark.asyncio
async def test_admin_create_user_success(client: AsyncClient, db_session: AsyncSession) -> None:
    # 1. Create an admin user directly in DB
    admin = User(
        email="admin@example.com",
        full_name="Admin User",
        hashed_password=hash_password("adminpassword123"),
        is_superuser=True,
        is_active=True,
    )
    db_session.add(admin)
    await db_session.commit()
    await db_session.refresh(admin)

    # 2. Generate admin token
    admin_token = create_access_token(admin.id)

    # 3. Create a new user via API
    response = await client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "email": "newuser@example.com",
            "full_name": "New User",
            "password": "Securepassword123",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "newuser@example.com"
    assert "id" in data


@pytest.mark.asyncio
async def test_non_admin_create_user_forbidden(client: AsyncClient, db_session: AsyncSession) -> None:
    # 1. Create a regular user directly in DB
    user = User(
        email="regular@example.com",
        full_name="Regular User",
        hashed_password=hash_password("password123"),
        is_superuser=False,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # 2. Generate regular token
    token = create_access_token(user.id)

    # 3. Attempt to create a user (should fail)
    response = await client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": "another@example.com",
            "full_name": "Another User",
            "password": "Securepassword123",
        },
    )
    assert response.status_code == 403
