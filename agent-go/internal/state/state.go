// Package state persists the agent's last-known scan results so discovery
// data survives restarts and is never re-reported unchanged.
package state

import (
"encoding/json"
"os"
"path/filepath"
"sync"
)

type Store struct {
dir string
mu  sync.Mutex
}

func New(dir string) *Store { return &Store{dir: dir} }

func (s *Store) path(name string) string { return filepath.Join(s.dir, name) }

// SaveJSON atomically writes v under name with 0600 perms.
func (s *Store) SaveJSON(name string, v interface{}) error {
s.mu.Lock()
defer s.mu.Unlock()
if err := os.MkdirAll(s.dir, 0700); err != nil {
return err
}
b, err := json.Marshal(v)
if err != nil {
return err
}
tmp := s.path(name + ".tmp")
if err := os.WriteFile(tmp, b, 0600); err != nil {
return err
}
return os.Rename(tmp, s.path(name))
}

// LoadJSON reads name into v; returns false if absent.
func (s *Store) LoadJSON(name string, v interface{}) (bool, error) {
s.mu.Lock()
defer s.mu.Unlock()
b, err := os.ReadFile(s.path(name))
if err != nil {
if os.IsNotExist(err) {
return false, nil
}
return false, err
}
return true, json.Unmarshal(b, v)
}
