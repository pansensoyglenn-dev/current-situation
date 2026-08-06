import numpy as np

arr1 = np.array([1, 2, 3, 4, 5])
arr2 = np.zeros(5)
arr3 = np.ones(3)
arr4 = np.arange(0, 10, 2)

print("Array from list:", arr1)
print("Zeros:", arr2)
print("Ones:", arr3)
print("Arange:", arr4)

print("First element:", arr1[0])
print("Last element:", arr1[-1])

print("arr1 + 10:", arr1 + 10)
print("arr1 * 2:", arr1 * 2)
print("arr1 ** 2:", arr1 ** 2)

print("Shape:", arr1.shape)
print("Size:", arr1.size)
print("Dtype:", arr1.dtype)