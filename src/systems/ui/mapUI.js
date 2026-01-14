/**
 * Map UI Module
 * Manages the location map modal window and interactions
 */

import { getContext } from '../../../../../../extensions.js';
import { generateQuietPrompt, chat, saveChatDebounced, characters, this_chid, user_avatar, chat_metadata } from '../../../../../../../script.js';
import { selected_group, getGroupMembers, groups } from '../../../../../../group-chats.js';
import { extensionSettings, committedTrackerData, lastGeneratedData, FALLBACK_AVATAR_DATA_URI } from '../../core/state.js';
import { saveSettings, saveChatData, loadChatData } from '../../core/persistence.js';
import { i18n } from '../../core/i18n.js';
import { getSafeThumbnailUrl } from '../../utils/avatars.js';
import { buildMapQuietPrompt, buildFurnitureQuietPrompt, parseMapJSON, parseFurnitureJSON, solveRoomLayout } from '../generation/mapPrompts.js';

/**
 * Map data structure stored per chat
 * @typedef {Object} MapData
 * @property {string} id - Unique map identifier
 * @property {string} name - Map display name
 * @property {'regional'|'location'} type - Map type
 * @property {Object} layout - Grid layout data
 * @property {Array} rooms - Array of room objects
 * @property {Object} characterLocations - Map of character name to room id
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 */

/**
 * Current map state for the active chat
 */
let currentMapData = {
    maps: [], // Array of MapData
    activeMapId: null, // Currently selected map ID
    characterLocations: {} // Global character locations (can span multiple maps)
};

/**
 * Get map data for current chat
 */
export function getMapData() {
    return currentMapData;
}

/**
 * Set map data for current chat
 * @param {Object} data - Map data to set
 */
export function setMapData(data) {
    currentMapData = data || {
        maps: [],
        activeMapId: null,
        characterLocations: {}
    };
}

/**
 * MapModal class
 * Manages the location map UI
 */
export class MapModal {
    constructor() {
        this.modal = null;
        this.isGenerating = false;
        this.selectedRoomId = null;
    }

    /**
     * Opens the map modal
     */
    async open() {
        // Create modal if it doesn't exist
        if (!this.modal) {
            this.createModal();
        }

        // Refresh UI state
        this.refreshMapList();
        this.renderActiveMap();
        this.renderLocationTracker();

        // Open the modal
        this.modal.classList.add('is-open');
    }

    /**
     * Closes the map modal
     */
    close() {
        if (this.modal) {
            this.modal.classList.remove('is-open');
        }
        this.selectedRoomId = null;
    }

    /**
     * Creates the modal DOM structure
     */
    createModal() {
        const modalHTML = `
            <div id="rpg-map-modal" class="rpg-map-modal" data-theme="${extensionSettings.theme || 'default'}">
                <div class="rpg-map-overlay"></div>
                <div class="rpg-map-container">
                    <div class="rpg-map-header">
                        <h2><i class="fa-solid fa-map"></i> <span data-i18n-key="map.modal.title">Location Map</span></h2>
                        <div class="rpg-map-header-buttons">
                            <button id="rpg-map-close" class="rpg-map-close-btn" title="Close">
                                <i class="fa-solid fa-times"></i>
                            </button>
                        </div>
                    </div>
                    <div class="rpg-map-content">
                        <!-- Left Panel: Map Display -->
                        <div class="rpg-map-left-panel">
                            <!-- Map Selection Controls -->
                            <div class="rpg-map-controls">
                                <div class="rpg-map-select-row">
                                    <select id="rpg-map-select" class="rpg-select rpg-map-dropdown">
                                        <option value="">-- Select Map --</option>
                                    </select>
                                    <button id="rpg-map-add" class="rpg-btn rpg-btn-icon" title="Create new map">
                                        <i class="fa-solid fa-plus"></i>
                                    </button>
                                    <button id="rpg-map-delete" class="rpg-btn rpg-btn-icon rpg-btn-danger" title="Delete selected map">
                                        <i class="fa-solid fa-minus"></i>
                                    </button>
                                </div>
                                <div class="rpg-map-action-row">
                                    <button id="rpg-map-regenerate" class="rpg-btn rpg-btn-primary rpg-map-regenerate-btn">
                                        <i class="fa-solid fa-sync"></i> <span data-i18n-key="map.modal.regenerate">(Re)generate Map</span>
                                    </button>
                                    <input type="text" id="rpg-map-instructions" class="rpg-map-instructions-input" placeholder="Extra instructions for generation...">
                                </div>
                                <div class="rpg-map-import-export-row">
                                    <button id="rpg-map-import" class="rpg-btn rpg-btn-secondary">
                                        <i class="fa-solid fa-file-import"></i> Import
                                    </button>
                                    <button id="rpg-map-export" class="rpg-btn rpg-btn-secondary">
                                        <i class="fa-solid fa-file-export"></i> Export
                                    </button>
                                </div>
                            </div>

                            <!-- Map Display Area -->
                            <div id="rpg-map-display" class="rpg-map-display">
                                <div class="rpg-map-empty-state">
                                    <i class="fa-solid fa-map-location-dot"></i>
                                    <p data-i18n-key="map.modal.noMapSelected">No map selected. Create a new map or select an existing one.</p>
                                </div>
                            </div>

                            <!-- Room Details Panel (shown when room is selected) -->
                            <div id="rpg-room-details" class="rpg-room-details" style="display: none;">
                                <div class="rpg-room-details-header">
                                    <h4 id="rpg-room-name">Room Name</h4>
                                    <button id="rpg-room-close" class="rpg-btn rpg-btn-icon" title="Close">
                                        <i class="fa-solid fa-times"></i>
                                    </button>
                                </div>
                                <div id="rpg-room-content" class="rpg-room-content">
                                    <!-- Room details will be rendered here -->
                                </div>
                                <div class="rpg-room-actions">
                                    <button id="rpg-room-regenerate-furniture" class="rpg-btn rpg-btn-secondary">
                                        <i class="fa-solid fa-couch"></i> Regenerate Furniture
                                    </button>
                                    <button id="rpg-room-move-char" class="rpg-btn rpg-btn-primary">
                                        <i class="fa-solid fa-person-walking"></i> Move Character Here
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Right Panel: Location Tracker -->
                        <div class="rpg-map-right-panel">
                            <div class="rpg-location-tracker">
                                <h3><i class="fa-solid fa-location-dot"></i> <span data-i18n-key="map.modal.locationTracker">Location Tracker</span></h3>
                                <div id="rpg-location-tracker-content" class="rpg-location-tracker-content">
                                    <!-- Character locations will be rendered here -->
                                </div>
                                <div class="rpg-location-tracker-actions">
                                    <button id="rpg-location-refresh" class="rpg-btn rpg-btn-secondary">
                                        <i class="fa-solid fa-sync"></i> Refresh from Chat
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('rpg-map-modal');

        // Add event listeners
        this.attachEventListeners();
    }

    /**
     * Attaches event listeners to modal elements
     */
    attachEventListeners() {
        // Close button
        this.modal.querySelector('#rpg-map-close').addEventListener('click', () => this.close());

        // Overlay click
        this.modal.querySelector('.rpg-map-overlay').addEventListener('click', () => this.close());

        // Map selection
        this.modal.querySelector('#rpg-map-select').addEventListener('change', (e) => {
            this.selectMap(e.target.value);
        });

        // Add map button
        this.modal.querySelector('#rpg-map-add').addEventListener('click', () => this.showCreateMapDialog());

        // Delete map button
        this.modal.querySelector('#rpg-map-delete').addEventListener('click', () => this.deleteActiveMap());

        // Regenerate map button
        this.modal.querySelector('#rpg-map-regenerate').addEventListener('click', () => this.regenerateMap());

        // Import/Export buttons
        this.modal.querySelector('#rpg-map-import').addEventListener('click', () => this.importMap());
        this.modal.querySelector('#rpg-map-export').addEventListener('click', () => this.exportMap());

        // Room details close button
        this.modal.querySelector('#rpg-room-close').addEventListener('click', () => this.closeRoomDetails());

        // Room actions
        this.modal.querySelector('#rpg-room-regenerate-furniture').addEventListener('click', () => this.regenerateRoomFurniture());
        this.modal.querySelector('#rpg-room-move-char').addEventListener('click', () => this.showMoveCharacterDialog());

        // Location refresh button
        this.modal.querySelector('#rpg-location-refresh').addEventListener('click', () => this.refreshLocationsFromChat());
    }

    /**
     * Refreshes the map dropdown list
     */
    refreshMapList() {
        const select = this.modal.querySelector('#rpg-map-select');
        select.innerHTML = '<option value="">-- Select Map --</option>';

        currentMapData.maps.forEach(map => {
            const option = document.createElement('option');
            option.value = map.id;
            option.textContent = `${map.name} (${map.type === 'regional' ? 'Regional' : 'Location'})`;
            if (map.id === currentMapData.activeMapId) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    }

    /**
     * Selects a map by ID
     * @param {string} mapId - Map ID to select
     */
    selectMap(mapId) {
        currentMapData.activeMapId = mapId || null;
        this.renderActiveMap();
        this.closeRoomDetails();
        saveChatData(); // Persist selection
    }

    /**
     * Gets the currently active map
     * @returns {MapData|null}
     */
    getActiveMap() {
        if (!currentMapData.activeMapId) return null;
        return currentMapData.maps.find(m => m.id === currentMapData.activeMapId) || null;
    }

    /**
     * Renders the active map in the display area
     */
    renderActiveMap() {
        const display = this.modal.querySelector('#rpg-map-display');
        const map = this.getActiveMap();

        if (!map) {
            display.innerHTML = `
                <div class="rpg-map-empty-state">
                    <i class="fa-solid fa-map-location-dot"></i>
                    <p data-i18n-key="map.modal.noMapSelected">No map selected. Create a new map or select an existing one.</p>
                </div>
            `;
            return;
        }

        if (!map.layout || !map.rooms || map.rooms.length === 0) {
            display.innerHTML = `
                <div class="rpg-map-empty-state">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <p>Map has no layout. Click "(Re)generate Map" to create one.</p>
                </div>
            `;
            return;
        }

        // Render the visual map
        display.innerHTML = this.buildMapGrid(map);

        // Add click handlers to rooms
        display.querySelectorAll('.rpg-map-room').forEach(roomEl => {
            roomEl.addEventListener('click', () => {
                const roomId = roomEl.dataset.roomId;
                this.showRoomDetails(roomId);
            });
        });
    }

    /**
     * Builds the visual map grid HTML
     * @param {MapData} map - Map data
     * @returns {string} HTML for the map grid
     */
    buildMapGrid(map) {
        const { layout, rooms, type } = map;
        const gridSize = layout.gridSize || { rows: 5, cols: 5 };

        // Create a 2D array for the grid
        const grid = Array(gridSize.rows).fill(null).map(() => Array(gridSize.cols).fill(null));

        // Place rooms on the grid
        rooms.forEach(room => {
            if (room.position && room.position.row < gridSize.rows && room.position.col < gridSize.cols) {
                grid[room.position.row][room.position.col] = room;
            }
        });

        let html = `<div class="rpg-map-grid" style="--grid-cols: ${gridSize.cols}; --grid-rows: ${gridSize.rows};">`;

        for (let row = 0; row < gridSize.rows; row++) {
            for (let col = 0; col < gridSize.cols; col++) {
                const room = grid[row][col];
                if (room) {
                    const charactersHere = this.getCharactersInRoom(room.id);
                    const isSelected = this.selectedRoomId === room.id;
                    const roomTypeIcon = this.getRoomTypeIcon(room.roomType);

                    html += `
                        <div class="rpg-map-room ${room.roomType || ''} ${isSelected ? 'selected' : ''}" 
                             data-room-id="${room.id}"
                             data-row="${row}"
                             data-col="${col}"
                             title="${room.name}">
                            <div class="rpg-map-room-icon">${roomTypeIcon}</div>
                            <div class="rpg-map-room-name">${room.name}</div>
                            ${charactersHere.length > 0 ? `
                                <div class="rpg-map-room-characters">
                                    ${charactersHere.map(char => `
                                        <div class="rpg-map-character-avatar" title="${char.name}">
                                            <img src="${char.avatar || FALLBACK_AVATAR_DATA_URI}" alt="${char.name}" onerror="this.src='${FALLBACK_AVATAR_DATA_URI}'">
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                    `;
                } else {
                    // Empty cell or corridor
                    const isCorridor = layout.corridors?.some(c => c.row === row && c.col === col);
                    html += `
                        <div class="rpg-map-cell ${isCorridor ? 'corridor' : 'empty'}">
                            ${isCorridor ? '<div class="rpg-map-corridor-line"></div>' : ''}
                        </div>
                    `;
                }
            }
        }

        html += '</div>';
        return html;
    }

    /**
     * Gets icon for room type
     * @param {string} roomType - Room type identifier
     * @returns {string} Icon or emoji
     */
    getRoomTypeIcon(roomType) {
        const icons = {
            'entrance': '🚪',
            'bedroom': '🛏️',
            'kitchen': '🍳',
            'bathroom': '🚿',
            'living': '🛋️',
            'dining': '🍽️',
            'storage': '📦',
            'office': '💼',
            'library': '📚',
            'garden': '🌳',
            'shop': '🏪',
            'tavern': '🍺',
            'temple': '⛪',
            'smithy': '⚒️',
            'stable': '🐴',
            'dungeon': '⛓️',
            'throne': '👑',
            'corridor': '↔️',
            'street': '🛣️',
            'plaza': '🏛️',
            'market': '🛒',
            'default': '📍'
        };
        return icons[roomType] || icons['default'];
    }

    /**
     * Gets characters currently in a room
     * @param {string} roomId - Room ID
     * @returns {Array} Array of character objects with name and avatar
     */
    getCharactersInRoom(roomId) {
        const characters = [];
        const locations = currentMapData.characterLocations || {};

        for (const [charName, location] of Object.entries(locations)) {
            if (location.roomId === roomId) {
                characters.push({
                    name: charName,
                    avatar: this.getCharacterAvatar(charName)
                });
            }
        }

        return characters;
    }

    /**
     * Gets avatar URL for a character
     * @param {string} name - Character name
     * @returns {string|null} Avatar URL
     */
    getCharacterAvatar(name) {
        const context = getContext();

        // Check if it's the user
        if (name === context.name1 && user_avatar) {
            return getSafeThumbnailUrl('persona', user_avatar);
        }

        // Check custom NPC avatars
        if (extensionSettings.npcAvatars?.[name]) {
            return extensionSettings.npcAvatars[name];
        }

        // Check characters array
        if (characters && Array.isArray(characters)) {
            const char = characters.find(c => c.name === name);
            if (char?.avatar) {
                return getSafeThumbnailUrl('character', char.avatar);
            }
        }

        // Check group members
        if (selected_group) {
            const members = getGroupMembers();
            if (members) {
                const member = members.find(m => m.name === name);
                if (member?.avatar) {
                    return getSafeThumbnailUrl('character', member.avatar);
                }
            }
        }

        return null;
    }

    /**
     * Shows room details panel
     * @param {string} roomId - Room ID
     */
    showRoomDetails(roomId) {
        const map = this.getActiveMap();
        if (!map) return;

        const room = map.rooms.find(r => r.id === roomId);
        if (!room) return;

        this.selectedRoomId = roomId;

        // Update room selection in grid
        this.modal.querySelectorAll('.rpg-map-room').forEach(el => {
            el.classList.toggle('selected', el.dataset.roomId === roomId);
        });

        // Show room details panel
        const detailsPanel = this.modal.querySelector('#rpg-room-details');
        const roomName = this.modal.querySelector('#rpg-room-name');
        const roomContent = this.modal.querySelector('#rpg-room-content');

        roomName.textContent = room.name;

        let html = `
            <div class="rpg-room-info">
                <p class="rpg-room-description">${room.description || 'No description available.'}</p>
        `;

        if (room.furniture && room.furniture.length > 0) {
            html += `
                <div class="rpg-room-furniture">
                    <h5><i class="fa-solid fa-couch"></i> Furniture & Objects</h5>
                    <ul>
                        ${room.furniture.map(item => `
                            <li>
                                <strong>${item.name}</strong>
                                ${item.description ? `<span class="rpg-furniture-desc">${item.description}</span>` : ''}
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }

        // Show characters in this room
        const charactersHere = this.getCharactersInRoom(roomId);
        if (charactersHere.length > 0) {
            html += `
                <div class="rpg-room-characters-list">
                    <h5><i class="fa-solid fa-users"></i> Characters Present</h5>
                    <div class="rpg-room-character-grid">
                        ${charactersHere.map(char => `
                            <div class="rpg-room-character">
                                <img src="${char.avatar || FALLBACK_AVATAR_DATA_URI}" alt="${char.name}" onerror="this.src='${FALLBACK_AVATAR_DATA_URI}'">
                                <span>${char.name}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Exits/connections
        if (room.exits && room.exits.length > 0) {
            html += `
                <div class="rpg-room-exits">
                    <h5><i class="fa-solid fa-door-open"></i> Exits</h5>
                    <ul>
                        ${room.exits.map(exit => `<li>${exit.direction}: ${exit.destination}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        html += '</div>';
        roomContent.innerHTML = html;
        detailsPanel.style.display = 'block';
    }

    /**
     * Closes the room details panel
     */
    closeRoomDetails() {
        this.selectedRoomId = null;
        this.modal.querySelector('#rpg-room-details').style.display = 'none';
        this.modal.querySelectorAll('.rpg-map-room.selected').forEach(el => el.classList.remove('selected'));
    }

    /**
     * Renders the location tracker panel
     */
    renderLocationTracker() {
        const content = this.modal.querySelector('#rpg-location-tracker-content');
        const locations = currentMapData.characterLocations || {};

        if (Object.keys(locations).length === 0) {
            content.innerHTML = `
                <div class="rpg-location-empty">
                    <p>No character locations tracked yet.</p>
                    <small>Click "Refresh from Chat" to detect locations from the conversation.</small>
                </div>
            `;
            return;
        }

        let html = '<div class="rpg-location-list">';

        // Group by map
        const byMap = {};
        for (const [charName, location] of Object.entries(locations)) {
            const mapId = location.mapId || 'unknown';
            if (!byMap[mapId]) {
                byMap[mapId] = [];
            }
            byMap[mapId].push({ name: charName, ...location });
        }

        for (const [mapId, chars] of Object.entries(byMap)) {
            const map = currentMapData.maps.find(m => m.id === mapId);
            const mapName = map?.name || 'Unknown Location';

            html += `
                <div class="rpg-location-map-group">
                    <h5><i class="fa-solid fa-map"></i> ${mapName}</h5>
                    <ul>
                        ${chars.map(char => {
                            const room = map?.rooms?.find(r => r.id === char.roomId);
                            const roomName = room?.name || char.roomId || 'Unknown';
                            const avatar = this.getCharacterAvatar(char.name);
                            return `
                                <li class="rpg-location-item">
                                    <img src="${avatar || FALLBACK_AVATAR_DATA_URI}" alt="${char.name}" class="rpg-location-avatar" onerror="this.src='${FALLBACK_AVATAR_DATA_URI}'">
                                    <span class="rpg-location-char-name">${char.name}</span>
                                    <span class="rpg-location-room">${roomName}</span>
                                </li>
                            `;
                        }).join('')}
                    </ul>
                </div>
            `;
        }

        html += '</div>';
        content.innerHTML = html;
    }

    /**
     * Shows the create map dialog
     */
    async showCreateMapDialog() {
        return new Promise((resolve) => {
            const dialogHTML = `
                <div id="rpg-create-map-dialog" class="rpg-map-dialog" data-theme="${extensionSettings.theme || 'default'}">
                    <div class="rpg-map-dialog-overlay"></div>
                    <div class="rpg-map-dialog-content">
                        <h3><i class="fa-solid fa-plus"></i> Create New Map</h3>
                        <div class="rpg-map-dialog-body">
                            <div class="rpg-setting-row">
                                <label for="new-map-name">Map Name:</label>
                                <input type="text" id="new-map-name" class="text_pole" placeholder="e.g., Tavern Interior, Village Streets">
                            </div>
                            <div class="rpg-setting-row">
                                <label for="new-map-type">Map Type:</label>
                                <select id="new-map-type" class="rpg-select">
                                    <option value="location">Location (Building Interior)</option>
                                    <option value="regional">Regional (Streets/Outdoors)</option>
                                </select>
                            </div>
                            <div class="rpg-setting-row">
                                <label for="new-map-description">Description (optional):</label>
                                <textarea id="new-map-description" class="text_pole" rows="3" placeholder="Describe the location for better generation..."></textarea>
                            </div>
                        </div>
                        <div class="rpg-map-dialog-footer">
                            <button id="create-map-cancel" class="rpg-btn rpg-btn-secondary">Cancel</button>
                            <button id="create-map-confirm" class="rpg-btn rpg-btn-primary">Create & Generate</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.insertAdjacentHTML('beforeend', dialogHTML);
            const dialog = document.getElementById('rpg-create-map-dialog');

            // Focus name input
            setTimeout(() => dialog.querySelector('#new-map-name').focus(), 100);

            const cleanup = () => {
                dialog.remove();
            };

            dialog.querySelector('#create-map-cancel').addEventListener('click', () => {
                cleanup();
                resolve(null);
            });

            dialog.querySelector('.rpg-map-dialog-overlay').addEventListener('click', () => {
                cleanup();
                resolve(null);
            });

            dialog.querySelector('#create-map-confirm').addEventListener('click', async () => {
                const name = dialog.querySelector('#new-map-name').value.trim();
                const type = dialog.querySelector('#new-map-type').value;
                const description = dialog.querySelector('#new-map-description').value.trim();

                if (!name) {
                    toastr.warning('Please enter a map name');
                    return;
                }

                cleanup();

                // Create new map entry
                const newMap = {
                    id: `map_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: name,
                    type: type,
                    description: description,
                    layout: null,
                    rooms: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                currentMapData.maps.push(newMap);
                currentMapData.activeMapId = newMap.id;

                // Save and refresh
                saveChatData();
                this.refreshMapList();
                this.renderActiveMap();

                // Auto-generate the map
                await this.regenerateMap();

                resolve(newMap);
            });
        });
    }

    /**
     * Deletes the active map
     */
    deleteActiveMap() {
        const map = this.getActiveMap();
        if (!map) {
            toastr.warning('No map selected');
            return;
        }

        if (!confirm(`Delete map "${map.name}"? This cannot be undone.`)) {
            return;
        }

        // Remove map from list
        currentMapData.maps = currentMapData.maps.filter(m => m.id !== map.id);

        // Remove character locations for this map
        for (const [charName, location] of Object.entries(currentMapData.characterLocations)) {
            if (location.mapId === map.id) {
                delete currentMapData.characterLocations[charName];
            }
        }

        // Clear active map
        currentMapData.activeMapId = null;

        // Save and refresh
        saveChatData();
        this.refreshMapList();
        this.renderActiveMap();
        this.renderLocationTracker();
        this.closeRoomDetails();

        toastr.success(`Map "${map.name}" deleted`);
    }

    /**
     * Regenerates the active map using LLM
     */
    async regenerateMap() {
        const map = this.getActiveMap();
        if (!map) {
            toastr.warning('No map selected');
            return;
        }

        if (this.isGenerating) {
            toastr.warning('Generation already in progress');
            return;
        }

        this.isGenerating = true;
        const regenerateBtn = this.modal.querySelector('#rpg-map-regenerate');
        const originalBtnText = regenerateBtn.innerHTML;
        regenerateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';
        regenerateBtn.disabled = true;

        try {
            const extraInstructions = this.modal.querySelector('#rpg-map-instructions').value.trim();

            // Build quiet prompt for map generation (uses full context template)
            const quietPrompt = buildMapQuietPrompt(map.name, map.description, extraInstructions, map.type);

            // Generate via LLM with full context template support
            const response = await generateQuietPrompt({
                quietPrompt: quietPrompt,
                skipWIAN: false
            });

            if (!response) {
                toastr.error('No response from AI');
                return;
            }

            // Parse the simplified response (just room names, sizes, exits, furniture names)
            const parsedData = parseMapJSON(response);

            if (!parsedData || !parsedData.rooms) {
                toastr.error('Invalid map data returned. Try regenerating.');
                console.error('[RPG Companion] Invalid map response:', response);
                return;
            }

            // Use the layout solver to position rooms programmatically
            const layoutData = solveRoomLayout(parsedData.rooms);

            // Update the map with solved layout
            map.layout = layoutData.layout;
            map.rooms = layoutData.rooms;
            map.updatedAt = new Date().toISOString();

            // Save and refresh
            saveChatData();
            this.renderActiveMap();

            toastr.success(`Map "${map.name}" generated successfully!`);

        } catch (error) {
            console.error('[RPG Companion] Map generation error:', error);
            toastr.error(`Failed to generate map: ${error.message}`);
        } finally {
            this.isGenerating = false;
            regenerateBtn.innerHTML = originalBtnText;
            regenerateBtn.disabled = false;
        }
    }

    /**
     * Regenerates furniture for the selected room
     */
    async regenerateRoomFurniture() {
        const map = this.getActiveMap();
        const room = map?.rooms?.find(r => r.id === this.selectedRoomId);
        if (!room) {
            toastr.warning('No room selected');
            return;
        }

        if (this.isGenerating) {
            toastr.warning('Generation already in progress');
            return;
        }

        this.isGenerating = true;
        const btn = this.modal.querySelector('#rpg-room-regenerate-furniture');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;

        try {
            // Build quiet prompt for furniture generation
            const quietPrompt = buildFurnitureQuietPrompt(room.name);

            // Generate via LLM with full context template support
            const response = await generateQuietPrompt({
                quietPrompt: quietPrompt,
                skipWIAN: false
            });

            if (!response) {
                toastr.error('No response from AI');
                return;
            }

            // Parse furniture from response (just names now)
            const furnitureArray = parseFurnitureJSON(response);

            if (furnitureArray && furnitureArray.length > 0) {
                room.furniture = furnitureArray;
                map.updatedAt = new Date().toISOString();

                saveChatData();
                this.showRoomDetails(room.id); // Refresh room details

                toastr.success('Furniture regenerated!');
            } else {
                toastr.error('Invalid furniture data');
            }

        } catch (error) {
            console.error('[RPG Companion] Furniture generation error:', error);
            toastr.error(`Failed to regenerate furniture: ${error.message}`);
        } finally {
            this.isGenerating = false;
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }

    /**
     * Shows dialog to move a character to the selected room
     */
    showMoveCharacterDialog() {
        if (!this.selectedRoomId) {
            toastr.warning('No room selected');
            return;
        }

        const map = this.getActiveMap();
        const room = map?.rooms?.find(r => r.id === this.selectedRoomId);
        if (!room) return;

        // Get available characters (from tracker data)
        const availableChars = this.getAvailableCharacters();

        const dialogHTML = `
            <div id="rpg-move-char-dialog" class="rpg-map-dialog" data-theme="${extensionSettings.theme || 'default'}">
                <div class="rpg-map-dialog-overlay"></div>
                <div class="rpg-map-dialog-content" style="max-width: 400px;">
                    <h3><i class="fa-solid fa-person-walking"></i> Move Character</h3>
                    <div class="rpg-map-dialog-body">
                        <p>Move character to <strong>${room.name}</strong></p>
                        <div class="rpg-setting-row">
                            <label for="move-char-select">Character:</label>
                            <select id="move-char-select" class="rpg-select">
                                <option value="">-- Select Character --</option>
                                ${availableChars.map(c => `<option value="${c}">${c}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="rpg-map-dialog-footer">
                        <button id="move-char-cancel" class="rpg-btn rpg-btn-secondary">Cancel</button>
                        <button id="move-char-confirm" class="rpg-btn rpg-btn-primary">Move</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', dialogHTML);
        const dialog = document.getElementById('rpg-move-char-dialog');

        const cleanup = () => dialog.remove();

        dialog.querySelector('#move-char-cancel').addEventListener('click', cleanup);
        dialog.querySelector('.rpg-map-dialog-overlay').addEventListener('click', cleanup);

        dialog.querySelector('#move-char-confirm').addEventListener('click', () => {
            const charName = dialog.querySelector('#move-char-select').value;
            if (!charName) {
                toastr.warning('Please select a character');
                return;
            }

            // Update character location
            currentMapData.characterLocations[charName] = {
                mapId: map.id,
                roomId: this.selectedRoomId
            };

            saveChatData();
            this.renderActiveMap();
            this.renderLocationTracker();
            this.showRoomDetails(this.selectedRoomId);

            cleanup();
            toastr.success(`${charName} moved to ${room.name}`);
        });
    }

    /**
     * Gets list of available characters for location tracking
     * @returns {Array<string>} Character names
     */
    getAvailableCharacters() {
        const chars = new Set();
        const context = getContext();

        // Add user
        if (context.name1) {
            chars.add(context.name1);
        }

        // Add from present characters in tracker
        const trackerData = lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts;
        if (trackerData?.characters) {
            trackerData.characters.forEach(c => {
                if (c.name) chars.add(c.name);
            });
        }

        // Add main character
        if (characters && characters[this_chid]) {
            chars.add(characters[this_chid].name);
        }

        // Add group members
        if (selected_group) {
            const members = getGroupMembers();
            if (members) {
                members.forEach(m => chars.add(m.name));
            }
        }

        return Array.from(chars);
    }

    /**
     * Refreshes character locations from chat context
     */
    async refreshLocationsFromChat() {
        // This would analyze recent chat messages to detect location mentions
        // For now, show a toast indicating the feature
        toastr.info('Analyzing chat for location mentions...');

        // Get the current location from info box if available
        const infoBox = lastGeneratedData.infoBox || committedTrackerData.infoBox;
        if (infoBox?.location?.value) {
            // If we have a map that matches this location name, update user's location
            const locationName = infoBox.location.value;
            const matchingMap = currentMapData.maps.find(m =>
                m.name.toLowerCase().includes(locationName.toLowerCase()) ||
                locationName.toLowerCase().includes(m.name.toLowerCase())
            );

            if (matchingMap && matchingMap.rooms && matchingMap.rooms.length > 0) {
                const context = getContext();
                // Put user in first room (entrance) if not already placed
                if (!currentMapData.characterLocations[context.name1]) {
                    const entranceRoom = matchingMap.rooms.find(r => r.roomType === 'entrance') || matchingMap.rooms[0];
                    currentMapData.characterLocations[context.name1] = {
                        mapId: matchingMap.id,
                        roomId: entranceRoom.id
                    };
                    saveChatData();
                    this.renderActiveMap();
                    this.renderLocationTracker();
                    toastr.success(`Detected location: ${locationName}`);
                    return;
                }
            }
        }

        this.renderLocationTracker();
        toastr.info('Location refresh complete');
    }

    /**
     * Exports the active map to a JSON file
     */
    exportMap() {
        const map = this.getActiveMap();
        if (!map) {
            toastr.warning('No map selected to export');
            return;
        }

        const exportData = {
            version: 1,
            exportedAt: new Date().toISOString(),
            map: map
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rpg-map-${map.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        toastr.success(`Map "${map.name}" exported`);
    }

    /**
     * Imports a map from a JSON file
     */
    importMap() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text);

                if (!data.map || !data.map.name) {
                    toastr.error('Invalid map file format');
                    return;
                }

                // Generate new ID to avoid conflicts
                const importedMap = {
                    ...data.map,
                    id: `map_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                currentMapData.maps.push(importedMap);
                currentMapData.activeMapId = importedMap.id;

                saveChatData();
                this.refreshMapList();
                this.renderActiveMap();

                toastr.success(`Map "${importedMap.name}" imported successfully`);

            } catch (error) {
                console.error('[RPG Companion] Import error:', error);
                toastr.error('Failed to import map file');
            }
        };

        input.click();
    }
}

// Singleton instance
let mapModalInstance = null;

/**
 * Opens the map modal (creates instance if needed)
 */
export function openMapModal() {
    if (!mapModalInstance) {
        mapModalInstance = new MapModal();
    }
    mapModalInstance.open();
}

/**
 * Gets the map modal instance
 * @returns {MapModal|null}
 */
export function getMapModal() {
    return mapModalInstance;
}
