// Centralized Input Manager
// Singleton pattern for global keyboard input handling
// Components can subscribe to actions and poll input state

export type InputAction =
  | 'move_up' | 'move_down' | 'move_left' | 'move_right'
  | 'zoom_in' | 'zoom_out'
  | 'yaw_flatten' | 'yaw_steepen'
  | 'view_prev' | 'view_next'
  | 'snap_toggle' | 'snap_up' | 'snap_down' | 'snap_left' | 'snap_right'
  | 'filter_cycle' | 'filter_menu_open' | 'filter_menu_close'
  | 'search_focus' | 'search_blur'
  | 'select_hovered' | 'deselect'
  | 'toggle_layers';

export interface InputState {
  // Movement
  moveUp: boolean;
  moveDown: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  // Zoom
  zoomIn: boolean;
  zoomOut: boolean;
  // Camera yaw
  yawFlatten: boolean;
  yawSteepen: boolean;
  // Modifiers
  shiftHeld: boolean;
  ctrlHeld: boolean;
  altHeld: boolean;
}

type ActionCallback = (action: InputAction) => void;

class InputManager {
  private state: InputState = {
    moveUp: false,
    moveDown: false,
    moveLeft: false,
    moveRight: false,
    zoomIn: false,
    zoomOut: false,
    yawFlatten: false,
    yawSteepen: false,
    shiftHeld: false,
    ctrlHeld: false,
    altHeld: false,
  };
  
  private canvasSubscribers = new Set<ActionCallback>();
  private uiSubscribers = new Set<ActionCallback>();
  private globalSubscribers = new Set<ActionCallback>();
  
  private tabPressTime: number | null = null;
  private tabHoldTimeout: ReturnType<typeof setTimeout> | null = null;
  private shiftUsedWithOtherKey = false;
  private initialized = false;
  
  constructor() {
    // Bind methods
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
  }
  
  init() {
    if (this.initialized || typeof window === 'undefined') return;
    
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.initialized = true;
  }
  
  destroy() {
    if (!this.initialized || typeof window === 'undefined') return;
    
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    if (this.tabHoldTimeout) clearTimeout(this.tabHoldTimeout);
    this.initialized = false;
  }
  
  getState(): InputState {
    return this.state;
  }
  
  subscribeCanvas(callback: ActionCallback): () => void {
    this.canvasSubscribers.add(callback);
    return () => this.canvasSubscribers.delete(callback);
  }
  
  subscribeUI(callback: ActionCallback): () => void {
    this.uiSubscribers.add(callback);
    return () => this.uiSubscribers.delete(callback);
  }
  
  subscribeGlobal(callback: ActionCallback): () => void {
    this.globalSubscribers.add(callback);
    return () => this.globalSubscribers.delete(callback);
  }
  
  private dispatch(action: InputAction, target: 'canvas' | 'ui' | 'global') {
    if (target === 'canvas') {
      this.canvasSubscribers.forEach(cb => cb(action));
    } else if (target === 'ui') {
      this.uiSubscribers.forEach(cb => cb(action));
    } else if (target === 'global') {
      this.globalSubscribers.forEach(cb => cb(action));
      this.canvasSubscribers.forEach(cb => cb(action));
      this.uiSubscribers.forEach(cb => cb(action));
    }
  }
  
  private handleKeyDown(e: KeyboardEvent) {
    // Skip if in input field (except for Escape)
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      if (e.key === 'Escape') {
        this.dispatch('search_blur', 'ui');
      }
      return;
    }
    
    // Track modifier keys
    if (e.key === 'Shift') {
      this.state.shiftHeld = true;
      return;
    }
    if (e.key === 'Control') {
      this.state.ctrlHeld = true;
      return;
    }
    if (e.key === 'Alt') {
      this.state.altHeld = true;
      return;
    }
    
    // Mark shift as used with other key
    if (this.state.shiftHeld && e.key !== 'Shift') {
      this.shiftUsedWithOtherKey = true;
    }
    
    // === Tab key - Filter mode ===
    if (e.key === 'Tab' && !this.state.shiftHeld && !this.state.ctrlHeld && !this.state.altHeld) {
      e.preventDefault();
      e.stopPropagation();
      
      if (e.repeat) return;
      
      if (this.tabPressTime === null) {
        this.tabPressTime = Date.now();
        
        this.tabHoldTimeout = setTimeout(() => {
          this.dispatch('filter_menu_open', 'ui');
        }, 300);
      }
      return;
    }
    
    // === Space key - Search focus ===
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      this.dispatch('search_focus', 'ui');
      return;
    }
    
    // === Enter key - Select hovered ===
    if (e.key === 'Enter') {
      this.dispatch('select_hovered', 'global');
      return;
    }
    
    // === Slash key - Toggle layers ===
    if (e.key === '/') {
      e.preventDefault();
      if (!e.repeat) this.dispatch('toggle_layers', 'global');
      return;
    }

    // === Escape key - Deselect ===
    if (e.key === 'Escape') {
      this.dispatch('deselect', 'global');
      return;
    }
    
    // === Q/E keys ===
    if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      if (!e.repeat) this.dispatch('view_prev', 'canvas');
      this.state.yawFlatten = true;
      return;
    }
    if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      if (!e.repeat) this.dispatch('view_next', 'canvas');
      this.state.yawSteepen = true;
      return;
    }
    
    // === Movement / Zoom keys ===
    const isMovementKey = ['w', 'W', 'a', 'A', 's', 'S', 'd', 'D', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
    
    if (isMovementKey) {
      e.preventDefault();
      
      // Shift + W/S = Zoom
      if (this.state.shiftHeld && ['w', 'W', 'ArrowUp'].includes(e.key)) {
        this.state.zoomIn = true;
        return;
      }
      if (this.state.shiftHeld && ['s', 'S', 'ArrowDown'].includes(e.key)) {
        this.state.zoomOut = true;
        return;
      }
      // Shift + A/D = reserved
      if (this.state.shiftHeld) {
        return;
      }
      
      // Dispatch snap actions (canvas will decide if in snap mode)
      if (!e.repeat) {
        if (['w', 'W', 'ArrowUp'].includes(e.key)) this.dispatch('snap_up', 'canvas');
        if (['s', 'S', 'ArrowDown'].includes(e.key)) this.dispatch('snap_down', 'canvas');
        if (['a', 'A', 'ArrowLeft'].includes(e.key)) this.dispatch('snap_left', 'canvas');
        if (['d', 'D', 'ArrowRight'].includes(e.key)) this.dispatch('snap_right', 'canvas');
      }
      
      // Update movement state
      if (['w', 'W', 'ArrowUp'].includes(e.key)) this.state.moveUp = true;
      if (['s', 'S', 'ArrowDown'].includes(e.key)) this.state.moveDown = true;
      if (['a', 'A', 'ArrowLeft'].includes(e.key)) this.state.moveLeft = true;
      if (['d', 'D', 'ArrowRight'].includes(e.key)) this.state.moveRight = true;
      return;
    }
  }
  
  private handleKeyUp(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }
    
    // === Shift release - Toggle snap mode ===
    if (e.key === 'Shift') {
      if (!this.shiftUsedWithOtherKey && !this.state.ctrlHeld && !this.state.altHeld) {
        this.dispatch('snap_toggle', 'global');
      }
      this.state.shiftHeld = false;
      this.shiftUsedWithOtherKey = false;
      return;
    }
    
    if (e.key === 'Control') {
      this.state.ctrlHeld = false;
      return;
    }
    if (e.key === 'Alt') {
      this.state.altHeld = false;
      return;
    }
    
    // === Tab release ===
    if (e.key === 'Tab') {
      if (this.tabHoldTimeout) {
        clearTimeout(this.tabHoldTimeout);
        this.tabHoldTimeout = null;
      }
      
      if (this.tabPressTime !== null) {
        const holdDuration = Date.now() - this.tabPressTime;
        this.tabPressTime = null;
        
        if (holdDuration < 300) {
          this.dispatch('filter_cycle', 'ui');
        } else {
          this.dispatch('filter_menu_close', 'ui');
        }
      }
      return;
    }
    
    // === Q/E release ===
    if (e.key === 'q' || e.key === 'Q') this.state.yawFlatten = false;
    if (e.key === 'e' || e.key === 'E') this.state.yawSteepen = false;
    
    // === Movement key release ===
    if (['w', 'W', 'ArrowUp'].includes(e.key)) {
      this.state.moveUp = false;
      this.state.zoomIn = false;
    }
    if (['s', 'S', 'ArrowDown'].includes(e.key)) {
      this.state.moveDown = false;
      this.state.zoomOut = false;
    }
    if (['a', 'A', 'ArrowLeft'].includes(e.key)) this.state.moveLeft = false;
    if (['d', 'D', 'ArrowRight'].includes(e.key)) this.state.moveRight = false;
  }
}

// Export singleton instance
export const inputManager = new InputManager();

